export interface ChatContext {
  systemPrompt: string;
  metadata?: Record<string, unknown>;
}

export interface ContextProvider {
  buildContext(sourceId: string): Promise<ChatContext>;
}
