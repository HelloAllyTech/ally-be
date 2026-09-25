/**
 * Token counts the provider reported for one call. Recorded to `llm_usage` so
 * the debrief chat's spend is visible — it recorded nothing before.
 */
export interface LlmTokenUsage {
  promptTokens: number;
  completionTokens: number;
  /** Prompt-cache read tokens, when the provider reports them. */
  cachedTokens?: number;
}

export interface LlmStreamChunk {
  content: string;
  finishReason?: string;
  /**
   * Set on the chunk that carries the provider's usage report — the final one
   * for OpenAI (`stream_options.include_usage`), the latest cumulative figure
   * for Gemini. May arrive on a chunk with empty `content`.
   */
  usage?: LlmTokenUsage;
}

export interface LlmProviderConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmProvider {
  streamCompletion(
    messages: LlmMessage[],
    config: LlmProviderConfig,
  ): AsyncIterable<LlmStreamChunk>;

  getCompletion(
    messages: LlmMessage[],
    config: LlmProviderConfig,
    /** Called once with the call's token usage, when the provider reports it. */
    onUsage?: (usage: LlmTokenUsage) => void,
  ): Promise<string>;
}
