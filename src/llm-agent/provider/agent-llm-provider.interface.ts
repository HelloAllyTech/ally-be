import { AgentStreamEvent, AgentStreamRequest } from '../type/agent-llm.type';

/**
 * One streamed, tool-capable turn against a single provider.
 *
 * Unlike `llm-preview`'s `ILlmProvider` (single-shot, no tools) and
 * `ai-chat`'s `LlmProvider` (streamed text, no tools), this is the shape an
 * agent loop needs: text as it arrives, plus the tool calls the model wants
 * run before it will continue.
 *
 * Provider-side failures throw here rather than returning an error result.
 * An agent loop mid-interview cannot do anything useful with a half-turn, and
 * its caller already owns the transcript row that has to record the failure —
 * the opposite trade-off from the preview, whose whole output *is* the error.
 */
export interface IAgentLlmProvider {
  /** Canonical provider name, for usage accounting and error copy. */
  readonly name: string;

  stream(request: AgentStreamRequest): AsyncGenerator<AgentStreamEvent>;
}
