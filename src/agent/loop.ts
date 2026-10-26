import type { SandboxContainer } from '../sandbox/runner.js';
import {
  readFile,
  listFiles,
  searchCode,
  writeFile,
  runTests,
} from '../sandbox/tools.js';
import type { Message, ToolCall, ToolDefinition } from './llm.js';
import { getLLMProvider } from './llm.js';
import { buildSystemPrompt, buildUserPrompt } from './prompts.js';
import { appendLog, transitionRun, updateRun } from '../db/runs.js';
import { emitLog, emitStatus } from '../sse/stream.js';
import { config } from '../config.js';

// ── Tool definitions (OpenAI function calling schema) ─────────────────────────
const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to /workspace' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files in a directory (excludes node_modules, .git).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path relative to /workspace', default: '.' },
          max_depth: { type: 'number', description: 'Max directory depth', default: 3 },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Search for a text pattern in TypeScript/JavaScript files (recursive grep).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term or pattern' },
          path: { type: 'string', description: 'Directory to search in', default: '.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write (create or overwrite) a file with the given content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to /workspace' },
          content: { type: 'string', description: 'Complete file content' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_tests',
      description: 'Run the test suite (Jest or Vitest). Optionally filter by test file or test name.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: 'Optional test file path or test name filter' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_agent',
      description: 'Signal that the agent is done with this phase.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            enum: ['reproduced', 'done', 'could not reproduce', 'patch failed'],
            description: 'Why the agent is stopping',
          },
          reproduction_test_path: {
            type: 'string',
            description: 'Path to the reproduction test file (required when reason=reproduced)',
          },
        },
        required: ['reason'],
      },
    },
  },
];

// ── Agent result ──────────────────────────────────────────────────────────────
export interface AgentResult {
  success: boolean;
  reason: string;
  reproductionTestPath?: string;
  tokensUsed: number;
}

// ── Main agent loop ───────────────────────────────────────────────────────────
export async function runAgentLoop(opts: {
  runId: string;
  sandbox: SandboxContainer;
  repoUrl: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  phase: 'reproduce' | 'patch';
  previousAttempts?: string;
  maxAttempts?: number;
}): Promise<AgentResult> {
  const {
    runId,
    sandbox,
    repoUrl,
    issueNumber,
    issueTitle,
    issueBody,
    phase,
    previousAttempts,
    maxAttempts = config.AGENT_MAX_ATTEMPTS,
  } = opts;

  const llm = getLLMProvider();
  const messages: Message[] = [
    { role: 'system', content: buildSystemPrompt() },
    {
      role: 'user',
      content: buildUserPrompt({ repoUrl, issueNumber, issueTitle, issueBody, phase, previousAttempts }),
    },
  ];

  let totalTokens = 0;
  let iteration = 0;

  while (iteration < maxAttempts * 10) { // inner iterations per attempt
    iteration++;

    // Token budget check
    if (totalTokens >= config.AGENT_MAX_TOKENS) {
      return {
        success: false,
        reason: `Token budget exhausted (${totalTokens} tokens used)`,
        tokensUsed: totalTokens,
      };
    }

    await log(runId, `[agent] LLM call #${iteration}`, 'debug');

    const response = await llm.chat(messages, TOOL_DEFINITIONS);
    totalTokens += response.usage.prompt_tokens + response.usage.completion_tokens;
    await updateRun(runId, { token_usage: totalTokens });

    // Add assistant message to history
    messages.push({
      role: 'assistant',
      content: response.content,
      tool_calls: response.tool_calls.length > 0 ? response.tool_calls : undefined,
    });

    if (response.content) {
      await log(runId, response.content, 'info', 'agent');
    }

    // No tool calls → stop (model is done)
    if (response.tool_calls.length === 0) {
      return {
        success: false,
        reason: `Agent stopped without calling stop_agent (finish_reason=${response.finish_reason})`,
        tokensUsed: totalTokens,
      };
    }

    // Execute each tool call
    for (const call of response.tool_calls) {
      const toolResult = await dispatchTool(call, sandbox, runId);

      // Check for stop_agent
      if (call.function.name === 'stop_agent') {
        const args = parseArgs(call.function.arguments);
        const reason = args['reason'] as string;
        const reproPath = args['reproduction_test_path'] as string | undefined;

        await log(runId, `[agent] stop_agent called: reason="${reason}"`, 'info');

        return {
          success: reason === 'reproduced' || reason === 'done',
          reason,
          reproductionTestPath: reproPath,
          tokensUsed: totalTokens,
        };
      }

      // Add tool result to conversation
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: toolResult,
      });
    }
  }

  return {
    success: false,
    reason: 'Max iterations reached without agent stopping',
    tokensUsed: totalTokens,
  };
}

// ── Tool dispatcher ───────────────────────────────────────────────────────────
async function dispatchTool(
  call: ToolCall,
  sandbox: SandboxContainer,
  runId: string,
): Promise<string> {
  const args = parseArgs(call.function.arguments);
  await log(runId, `[tool] ${call.function.name}(${JSON.stringify(args)})`, 'debug', 'agent');

  try {
    switch (call.function.name) {
      case 'read_file': {
        const r = await readFile(sandbox, args['path'] as string);
        return r.ok ? r.output : `ERROR: ${r.error}`;
      }
      case 'list_files': {
        const r = await listFiles(sandbox, args['path'] as string ?? '.', args['max_depth'] as number ?? 3);
        return r.ok ? r.output : `ERROR: ${r.error}`;
      }
      case 'search_code': {
        const r = await searchCode(sandbox, args['query'] as string, args['path'] as string ?? '.');
        return r.ok ? r.output : `ERROR: ${r.error}`;
      }
      case 'write_file': {
        const r = await writeFile(sandbox, args['path'] as string, args['content'] as string);
        await log(runId, `write_file: ${args['path']}`, 'info', 'agent');
        return r.ok ? r.output : `ERROR: ${r.error}`;
      }
      case 'run_tests': {
        const r = await runTests(sandbox, args['filter'] as string | undefined);
        const summary = `Tests: ${r.passed} passed, ${r.failed} failed (exit=${r.exitCode})`;
        await log(runId, summary, r.ok ? 'info' : 'warn', 'sandbox');
        return `${summary}\n\n${r.output}`;
      }
      case 'stop_agent': {
        return 'stopping'; // handled in caller
      }
      default:
        return `ERROR: Unknown tool "${call.function.name}"`;
    }
  } catch (e: unknown) {
    return `ERROR: ${e instanceof Error ? e.message : String(e)}`;
  }
}

function parseArgs(argsJson: string): Record<string, unknown> {
  try {
    return JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function log(
  runId: string,
  message: string,
  level: 'info' | 'warn' | 'error' | 'debug' = 'info',
  source: 'agent' | 'sandbox' | 'system' = 'agent',
): Promise<void> {
  await appendLog(runId, message, level, source);
  emitLog({ runId, level, source, message, ts: new Date().toISOString() });
}
