import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMProvider, Message, ToolDefinition, LLMResponse } from '../src/agent/llm';
import { setLLMProvider } from '../src/agent/llm';

// Mock DB and SSE to avoid external dependencies
vi.mock('../src/db/runs', () => ({
  appendLog: vi.fn().mockResolvedValue(undefined),
  updateRun: vi.fn().mockResolvedValue(undefined),
  transitionRun: vi.fn().mockResolvedValue({}),
}));

vi.mock('../src/sse/stream', () => ({
  emitLog: vi.fn(),
  emitStatus: vi.fn(),
}));

vi.mock('../src/sandbox/tools', () => ({
  readFile: vi.fn().mockResolvedValue({ ok: true, output: 'export function sumTo() {}' }),
  listFiles: vi.fn().mockResolvedValue({ ok: true, output: 'src/math.ts\npackage.json' }),
  searchCode: vi.fn().mockResolvedValue({ ok: true, output: 'src/math.ts:5:for (let i = 1; i < n; i++)' }),
  writeFile: vi.fn().mockResolvedValue({ ok: true, output: 'Written /workspace/tests/repro.test.ts' }),
  runTests: vi.fn().mockResolvedValue({ ok: false, passed: 0, failed: 1, total: 1, output: '1 failed', exitCode: 1 }),
}));

import { runAgentLoop } from '../src/agent/loop';

const fakeSandbox = { id: 'test-sandbox', container: {} as any, workDir: '/workspace' };

describe('Agent Loop (runAgentLoop)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully reproduces a bug and calls stop_agent', async () => {
    let callCount = 0;
    const mockProvider: LLMProvider = {
      chat: vi.fn().mockImplementation(async (messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse> => {
        callCount++;
        if (callCount === 1) {
          // Turn 1: Inspect code
          return {
            content: 'Let me inspect the files',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'list_files', arguments: JSON.stringify({ path: '.' }) },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
            finish_reason: 'tool_calls',
          };
        } else if (callCount === 2) {
          // Turn 2: Write failing test
          return {
            content: 'Writing reproduction test',
            tool_calls: [
              {
                id: 'call_2',
                type: 'function',
                function: {
                  name: 'write_file',
                  arguments: JSON.stringify({
                    path: 'tests/repro.test.ts',
                    content: 'test content',
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 150, completion_tokens: 60 },
            finish_reason: 'tool_calls',
          };
        } else {
          // Turn 3: Stop agent with reproduced
          return {
            content: 'Bug is reproduced',
            tool_calls: [
              {
                id: 'call_3',
                type: 'function',
                function: {
                  name: 'stop_agent',
                  arguments: JSON.stringify({
                    reason: 'reproduced',
                    reproduction_test_path: 'tests/repro.test.ts',
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 120, completion_tokens: 30 },
            finish_reason: 'tool_calls',
          };
        }
      }),
    };

    setLLMProvider(mockProvider);

    const result = await runAgentLoop({
      runId: 'run-repro-123',
      sandbox: fakeSandbox,
      repoUrl: 'https://github.com/foo/bar',
      issueNumber: 1,
      issueTitle: 'Off by one in sumTo',
      issueBody: 'sumTo(5) returns 10 instead of 15',
      phase: 'reproduce',
    });

    expect(result.success).toBe(true);
    expect(result.reason).toBe('reproduced');
    expect(result.reproductionTestPath).toBe('tests/repro.test.ts');
    expect(result.tokensUsed).toBeGreaterThan(0);
  });

  it('successfully finishes patching phase with done', async () => {
    const mockProvider: LLMProvider = {
      chat: vi.fn().mockResolvedValue({
        content: 'Fix applied',
        tool_calls: [
          {
            id: 'call_done',
            type: 'function',
            function: {
              name: 'stop_agent',
              arguments: JSON.stringify({ reason: 'done' }),
            },
          },
        ],
        usage: { prompt_tokens: 80, completion_tokens: 20 },
        finish_reason: 'tool_calls',
      }),
    };

    setLLMProvider(mockProvider);

    const result = await runAgentLoop({
      runId: 'run-patch-123',
      sandbox: fakeSandbox,
      repoUrl: 'https://github.com/foo/bar',
      issueNumber: 1,
      issueTitle: 'Off by one in sumTo',
      issueBody: 'Description',
      phase: 'patch',
    });

    expect(result.success).toBe(true);
    expect(result.reason).toBe('done');
  });

  it('fails gracefully when agent signals could not reproduce', async () => {
    const mockProvider: LLMProvider = {
      chat: vi.fn().mockResolvedValue({
        content: 'Cannot find root cause',
        tool_calls: [
          {
            id: 'call_stop',
            type: 'function',
            function: {
              name: 'stop_agent',
              arguments: JSON.stringify({ reason: 'could not reproduce' }),
            },
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 15 },
        finish_reason: 'tool_calls',
      }),
    };

    setLLMProvider(mockProvider);

    const result = await runAgentLoop({
      runId: 'run-repro-fail',
      sandbox: fakeSandbox,
      repoUrl: 'https://github.com/foo/bar',
      issueNumber: 2,
      issueTitle: 'Flaky issue',
      issueBody: 'Cannot reproduce',
      phase: 'reproduce',
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('could not reproduce');
  });

  it('enforces token budget and terminates when exceeded', async () => {
    const mockProvider: LLMProvider = {
      chat: vi.fn().mockResolvedValue({
        content: 'Massive token response',
        tool_calls: [
          {
            id: 'call_explore',
            type: 'function',
            function: { name: 'list_files', arguments: '{}' },
          },
        ],
        usage: { prompt_tokens: 20000, completion_tokens: 15000 }, // > 32,000 max tokens
        finish_reason: 'tool_calls',
      }),
    };

    setLLMProvider(mockProvider);

    const result = await runAgentLoop({
      runId: 'run-budget-exceeded',
      sandbox: fakeSandbox,
      repoUrl: 'https://github.com/foo/bar',
      issueNumber: 3,
      issueTitle: 'Run with high token consumption',
      issueBody: 'Exceed budget',
      phase: 'patch',
    });

    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/Token budget exhausted/);
  });
});
