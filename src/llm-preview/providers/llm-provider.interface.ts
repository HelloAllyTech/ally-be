/**
 * Result of a single preview completion.
 *
 * A provider rejecting the call is a normal outcome here, not an exception: the
 * whole point of the preview is to surface "this model no longer works" as
 * readable text next to the config. Only misconfiguration on our side (missing
 * API key, un-previewable provider) raises.
 */
export interface LlmPreviewResult {
  ok: boolean;
  /** Model's reply, trimmed. Empty when the call failed. */
  text: string;
  /** Wall-clock time for the provider call. */
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  /**
   * The provider's own message, verbatim. Deliberately not normalised — the
   * provider's wording ("The model `gpt-4o-mini` has been deprecated") is the
   * part that tells you what to do next.
   */
  error?: string;
}

export interface ILlmProvider {
  /** Run `prompt` against the configured model. Never throws for provider-side
   *  failures; returns `ok: false` with the provider's message instead. */
  complete(prompt: string, timeoutMs: number): Promise<LlmPreviewResult>;
}
