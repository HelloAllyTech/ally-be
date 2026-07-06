import { JsonPatchOp } from '../util/json-patch.util';

/**
 * FROZEN SSE contract for
 * POST /v1/roleplay-studio/copilot/sessions/:id/messages/stream
 * (text/event-stream; each frame is `event: <name>\ndata: <json>\n\n`).
 */
export type CopilotSseEventName =
  | 'token'
  | 'tool_call'
  | 'tool_result'
  | 'spec_patch'
  | 'question'
  | 'error'
  | 'done';

export interface CopilotSseFrame {
  event: CopilotSseEventName;
  data: Record<string, any>;
}

export interface CopilotTokenEvent {
  delta: string;
}

export interface CopilotToolCallEvent {
  name: string;
  input: Record<string, any>;
}

export interface CopilotToolResultEvent {
  name: string;
  summary: string;
}

export interface CopilotSpecPatchEvent {
  patchId: string;
  summary: string;
  ops: JsonPatchOp[];
  specVersionId: string;
}

export interface CopilotQuestionEvent {
  id: string;
  prompt: string;
  kind: 'freeText' | 'choice';
  options?: string[];
}

export interface CopilotErrorEvent {
  code: string;
  message: string;
}

export interface CopilotDoneEvent {
  messageSeq: number;
  specVersionId: string | null;
}

/** What a tool execution hands back to the orchestrator loop. */
export interface ToolExecutionOutcome {
  /** JSON-serialised into the tool_result block returned to the model. */
  modelResult: Record<string, any>;
  /** One-line human summary for the tool_result SSE frame. */
  summary: string;
  /** Extra SSE frames to emit BEFORE the tool_result frame. */
  events?: CopilotSseFrame[];
  /** True ends the tool loop after this call (e.g. ask_trainer). */
  endTurn?: boolean;
}
