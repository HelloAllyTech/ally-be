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
  /**
   * Tokens served from the prompt cache — the saving.
   *
   * Reported separately from `cacheCreationTokens` because the two are priced
   * differently and a caller recording only one cannot say what a long session
   * actually cost: reads are what was saved, writes are what the saving cost
   * to set up. Undefined on providers that report neither.
   */
  cachedTokens?: number;
  /** Tokens written INTO the prompt cache — what the saving cost to set up. */
  cacheCreationTokens?: number;
}

export interface AgentTurnResult {
  content: AgentContentBlock[];
  stopReason: AgentStopReason;
  usage: AgentUsage;
}

/**
 * One span of the system instruction, when a caller needs the instruction
 * split rather than concatenated.
 *
 * The only reason to split is `cache`. A long stable prefix — repo knowledge,
 * curated lessons, worked examples — is worth marking as cacheable so a
 * twenty-turn interview pays full input price for it once instead of twenty
 * times; the volatile part must then come *after* the last cached block, or
 * every turn invalidates the prefix it was supposed to reuse.
 *
 * `cache` is an intent, not a provider flag. Anthropic honours it literally
 * (`cache_control: ephemeral`); the others have no per-request control and
 * simply receive the spans joined, which is exactly what they got before this
 * existed. A caller that does not care passes a plain string.
 */
export interface AgentSystemBlock {
  text: string;
  /** Cache everything up to and including this block, where the provider can. */
  cache?: boolean;
}

export interface AgentStreamRequest {
  model: string;
  /**
   * Plain text, or ordered spans when the caller needs cache boundaries.
   * Adapters that cannot express a boundary join the spans with a blank line.
   */
  system: string | AgentSystemBlock[];
  messages: AgentMessage[];
  maxTokens: number;
  /** Omitted for a deliberately tool-less pass (e.g. a wrap-up turn). */
  tools?: AgentToolDefinition[];
  /** Dropped by the adapters for models that reject a custom temperature. */
  temperature?: number;
  /**
   * Demand a bare JSON object rather than prose.
   *
   * Each provider reaches this differently and none of the mechanisms
   * translate, which is the reason it is a flag here rather than something a
   * caller does in its prompt: OpenAI has a real json_object response format,
   * Gemini has a JSON response mime type, and Anthropic has neither — it gets
   * a single forced tool whose input IS the object, the same approach ally-ai's
   * dispatch module uses.
   *
   * This replaces the assistant-turn prefill trick (`{` as a trailing assistant
   * message) that the autofill path used. The Claude 4.6+ family rejects that
   * outright with "This model does not support assistant message prefill", so
   * every JSON-expecting autofill on an Anthropic model was a 400.
   */
  jsonMode?: boolean;
  /**
   * Per-request deadline handed to the SDK.
   *
   * Passed to the provider's own request options rather than raced against in
   * the caller, because a race leaves the HTTP request running and its tokens
   * billable. Honoured by the Anthropic and OpenAI adapters; the Gemini SDK
   * takes a timeout at client construction, not per call, so it ignores this.
   */
  timeoutMs?: number;
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
