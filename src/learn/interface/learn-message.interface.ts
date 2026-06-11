import { MessageRequest } from 'src/ai/dto/ai.request.dto';
import { SessionEvents } from 'src/session-event/entity/session-events.entity';

export interface LearnMessageAndEventMessage {
  message_type: string;
  timestamp: number;
  room_id: string;
  data: LearnData;
}

export interface LearnData {
  chat_message?: MessageRequest;
  event?: LearnEventData;
  behavior_instruction?: LearnBehaviorInstructionData;
  turn_metrics?: LearnTurnMetricsData;
}

/**
 * Per-turn latency metrics emitted by ally-ai-learn (message_type
 * "turn_metrics"). All *Ms fields are integer milliseconds. The breakdown
 * fields are optional because some stages are skipped or not always measured.
 */
export interface LearnTurnMetricsData {
  turn_index: number;
  invocation_id?: string;
  response_latency_ms: number;
  eou_delay_ms?: number;
  llm_ttft_ms?: number;
  tts_ttfb_ms?: number;
  orchestration_ms?: number;
  llm_response_ms?: number;
  prosody_ms?: number;
  branching_ms?: number;
  knowledge_retrieval_ms?: number;
  process_events_ms?: number;
  behaviors_ms?: number;
  scenario_id?: number;
  language?: string;
  llm_model?: string;
  env?: string;
  response_chars?: number;
  events_detected?: number;
  prosody_skipped?: boolean;
  llm_timed_out?: boolean;
  interrupted?: boolean;
  metadata?: Record<string, any>;
}

export interface LearnBehaviorInstructionData {
  timestamp: Date;
  behavior_instruction_data: LearnBehaviorInstruction;
}

export interface LearnBehaviorInstruction {
  behaviorInstructionId: string;
}

export interface LearnEventData {
  timestamp: Date;
  event_data: LearnEvent;
}

export interface LearnEvent extends SessionEvents {
  autoTerminationStatus?: boolean;
  terminationMessage?: string;
  totalScore?: number;
}
