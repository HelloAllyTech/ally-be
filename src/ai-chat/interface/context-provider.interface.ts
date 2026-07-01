import { ScenarioSessionMessages } from 'src/learn/entity/scenario-session-messages.entity';

export interface ChatContext {
  systemPrompt: string;
  metadata?: {
    scenarioId?: number;
    scenarioSessionId?: string;
    transcriptTurns?: number;
    callDuration?: number;
    transcriptMessages?: ScenarioSessionMessages[];
    /**
     * Per-simulation LLM sampling temperature persisted on the scenario
     * (scenarios.metadata.temperature). Undefined when unset; consumers
     * fall back to the global default.
     */
    temperature?: number;
    /**
     * Prompt-level LLM model/temperature override for the chat prompt
     * (prompts.model / prompts.temperature). Undefined when unset. The chat
     * service applies these under the simulation temperature (precedence:
     * code default → prompt-level → simulation).
     */
    promptProvider?: string;
    promptModel?: string;
    promptTemperature?: number;
  };
}

export interface ContextProvider {
  buildContext(sourceId: string): Promise<ChatContext>;
}
