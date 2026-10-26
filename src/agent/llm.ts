import { config } from '../config.js';

// ── LLMProvider interface ─────────────────────────────────────────────────────
// This is the ONLY place in the codebase that knows about LLM APIs.
// All other code uses this interface — swap the implementation via env.

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface LLMResponse {
  content: string | null;
  tool_calls: ToolCall[];
  usage: { prompt_tokens: number; completion_tokens: number };
  finish_reason: string;
}

export interface LLMProvider {
  chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse>;
}

// ── OpenAI-compatible implementation ─────────────────────────────────────────
// Talks to any OpenAI-compatible endpoint (OpenAI, Groq, local vLLM, Ollama, etc.)
// configured via LLM_BASE_URL, LLM_API_KEY, LLM_MODEL env vars.

interface OpenAIChoice {
  message: {
    content: string | null;
    tool_calls?: ToolCall[];
  };
  finish_reason: string;
}

interface OpenAIResponse {
  choices: OpenAIChoice[];
  usage: { prompt_tokens: number; completion_tokens: number };
}

export class OpenAICompatibleProvider implements LLMProvider {
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(
    baseUrl = config.LLM_BASE_URL,
    apiKey = config.LLM_API_KEY,
    model = config.LLM_MODEL,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.model = model;
  }

  async chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: 0.2, // low temp for code tasks
    };

    if (tools && tools.length > 0) {
      body['tools'] = tools;
      body['tool_choice'] = 'auto';
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM API error ${res.status}: ${text}`);
    }

    const json = (await res.json()) as OpenAIResponse;
    const choice = json.choices[0];
    if (!choice) throw new Error('LLM returned no choices');

    return {
      content: choice.message.content,
      tool_calls: choice.message.tool_calls ?? [],
      usage: json.usage ?? { prompt_tokens: 0, completion_tokens: 0 },
      finish_reason: choice.finish_reason,
    };
  }
}

/** Default singleton provider — constructed from env */
let _provider: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
  if (!_provider) {
    _provider = new OpenAICompatibleProvider();
  }
  return _provider;
}

/** Override the provider (used in tests) */
export function setLLMProvider(p: LLMProvider): void {
  _provider = p;
}
