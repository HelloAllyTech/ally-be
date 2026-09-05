/**
 * Provider-neutral shapes for an agentic turn: streamed text plus tool calls
 * the caller executes and feeds back.
 *
 * The block vocabulary is deliberately Anthropic's (`tool_use` / `tool_result`
 * with a `tool_use_id`) rather than a third invented spelling. Two reasons:
 * every agentic service in ally-be already speaks it, and — the one that
 * actually forced the choice — `character_interview_messages.tool_calls` /
 * `.tool_results` have been persisting it since the feature shipped. Choosing a
 * new spelling would have meant a migration over live transcripts to gain
 * nothing. The OpenAI and Gemini adapters translate at their own edge.
 */

export type AgentContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface AgentMessage {
  role: 'user' | 'assistant';
  /** Plain prose, or a block list when the turn carries tool traffic. */
  content: string | AgentContentBlock[];
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  input_schema: Record<string, any>;
}

/**
 * Why the model stopped.
 *
 * Two of these are load-bearing rather than informational, because a caller
 * that reads either as a finished turn gets a silently wrong result:
 *
 * - `max_tokens` — the turn was cut off, so whatever it contains is a fragment
 *   of what the model was mid-way through writing (`length` on OpenAI,
 *   `MAX_TOKENS` on Gemini).
 * - `invalid_tool_call` — the model tried to call a tool and produced
 *   something unreadable, so the turn arrives *empty* and is otherwise
 *   indistinguishable from the model choosing to say nothing. Gemini
 *   (`MALFORMED_FUNCTION_CALL`) does this intermittently on a large tool
 *   schema; observed roughly once in three calls against the interview tools.
 *   It is transient, so it is worth a retry rather than an error.
 */
export type AgentStopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'invalid_tool_call'
  | 'other';

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
}

export interface AgentTurnResult {
  content: AgentContentBlock[];
  stopReason: AgentStopReason;
  usage: AgentUsage;
}

export interface AgentStreamRequest {
  model: string;
  system: string;
  messages: AgentMessage[];
  maxTokens: number;
  /** Omitted for a deliberately tool-less pass (e.g. a wrap-up turn). */
  tools?: AgentToolDefinition[];
  /** Dropped by the adapters for models that reject a custom temperature. */
  temperature?: number;
}

/**
 * Stream protocol: zero or more `text_delta`s, then exactly one `final`.
 *
 * A single generator rather than the SDK's `stream` + `finalMessage()` pair,
 * because the accumulated turn is the thing every caller needs and only
 * Anthropic's SDK hands it over for free — on the other two the adapter has to
 * assemble it from deltas anyway.
 */
export type AgentStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'final'; message: AgentTurnResult };
