import { ScenarioSessionMessages } from 'src/learn/entity/scenario-session-messages.entity';

export interface ChatContext {
  systemPrompt: string;
  metadata?: {
    scenarioId?: number;
    scenarioSessionId?: string;
    transcriptTurns?: number;
    callDuration?: number;
    transcriptMessages?: ScenarioSessionMessages[];
  };
}

export interface ContextProvider {
  buildContext(sourceId: string): Promise<ChatContext>;
}
