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
  start_metrics?: LearnStartMetricsData;
}

/**
 * Simulation START latency emitted once per session by ally-ai-learn
 * (message_type "start_metrics"). `start_latency_ms` is the headline metric
 * (agent job start -> the agent begins its opening dialogue); the segment
 * fields break it down. All *_ms fields are integer milliseconds.
 */
export interface LearnStartMetricsData {
  start_latency_ms: number;
  configure_ms?: number;
  initialize_ms?: number;
  connect_ms?: number;
  prep_ms?: number;
  /** Opening-statement TTS playout duration (informational; not in the total). */
  opening_playout_ms?: number;
  scenario_id?: number;
  language?: string;
  env?: string;
  metadata?: Record<string, any>;
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
  /** Pure STT finalization time (LiveKit EOUMetrics.transcription_delay), isolated from VAD-wait/EOU-decision time bundled into eou_delay_ms. */
  stt_finalize_ms?: number;
  llm_ttft_ms?: number;
  tts_ttfb_ms?: number;
  orchestration_ms?: number;
  llm_response_ms?: number;
  /** @deprecated Speech prosody removed; ally-ai-learn no longer emits this. */
  prosody_ms?: number;
  branching_ms?: number;
  knowledge_retrieval_ms?: number;
  process_events_ms?: number;
  behaviors_ms?: number;
  scenario_id?: number;
  language?: string;
  llm_model?: string;
  /** Inference provider for llm_model ('openai' | 'gemini' | 'anthropic'). */
  llm_provider?: string;
  /** Generation params — folded into the turn-metrics `metadata` jsonb. */
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  env?: string;
  response_chars?: number;
  events_detected?: number;
  /** @deprecated Speech prosody removed; ally-ai-learn no longer emits this. */
  prosody_skipped?: boolean;
  llm_timed_out?: boolean;
  interrupted?: boolean;
  metadata?: Record<string, any>;
}

/**
 * Token-usage payload (message_type "llm_usage") emitted by the Python services
 * (ally-ai / ally-ai-learn). Snake_case to match the wire format. Unlike
 * turn_metrics this is NOT necessarily tied to a scenario session — autofill,
 * translation, drift-judge and embeddings have no room — so `room_id` and the
 * correlation fields are all optional.
 */
export interface LlmUsageEventData {
  /** AI service: 'llm' | 'stt' | 'tts'. Defaults to 'llm' when omitted. */
  service?: string;
  unit?: string;
  provider: string;
  model: string;
  task: string;
  // LLM quantities.
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cached_tokens?: number;
  // STT billable audio duration (ms) / TTS billable characters.
  audio_ms?: number;
  characters?: number;
  env?: string;
  scenario_id?: number;
  scenario_session_id?: string;
  tenant_id?: string;
  metadata?: Record<string, any>;
}

/**
 * Full SQS envelope for an `llm_usage` message. Mirrors the turn_metrics
 * envelope: the payload rides under `data.llm_usage`. `room_id` is optional
 * (most usage events have no room).
 */
export interface LlmUsageMessage {
  message_type: string;
  timestamp?: number;
  room_id?: string;
  data: { llm_usage?: LlmUsageEventData };
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
  /** Epoch-ms timestamp for session-paused / session-resumed control events. */
  atMs?: number;
  /**
   * Cumulative paused milliseconds (agent SessionClock), carried on
   * session-resumed as the source of truth for excluded paused time.
   */
  totalPausedMs?: number;
}
