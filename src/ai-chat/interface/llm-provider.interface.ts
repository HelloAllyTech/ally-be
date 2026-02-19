export interface LlmStreamChunk {
  content: string;
  finishReason?: string;
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
}
