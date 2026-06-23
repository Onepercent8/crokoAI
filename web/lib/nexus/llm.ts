/**
 * Provider-agnostic LLM interface for the Nexus chat loop (SPEC-016 §"chat-loop").
 *
 * The Anthropic SDK sits BEHIND this interface so:
 *  - the chat loop is unit-testable with an in-memory fake (no network in tests);
 *  - the offline build never requires a live credential;
 *  - the provider can be swapped without touching the loop.
 *
 * The shapes here are a minimal subset of the Messages API tool-use protocol:
 * the model either returns text, or asks to call one of our tools. Tool calls
 * are DATA describing intent — the loop validates and decides what to execute.
 */

/** A tool the model may call, described by name + JSON schema. */
export interface LlmToolSpec {
  name: string;
  description: string;
  /** JSON Schema object for the tool input. */
  input_schema: Record<string, unknown>;
}

/** One message in the running conversation sent to the model. */
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: LlmContentBlock[];
}

export type LlmContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  tools: LlmToolSpec[];
  model: string;
  maxTokens: number;
}

export interface LlmResponse {
  /** Why the model stopped — `tool_use` means it wants a tool executed. */
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | string;
  /** The assistant content blocks (text and/or tool_use). */
  content: LlmContentBlock[];
}

/** The injectable LLM client. */
export interface LlmClient {
  createMessage(req: LlmRequest): Promise<LlmResponse>;
}
