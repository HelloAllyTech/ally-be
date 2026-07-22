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
  | 'behaviour_review'
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

/**
 * Interactive question kinds. `choice` is a legacy alias for `singleSelect`
 * kept so already-persisted messages and older clients still render.
 */
export type CopilotQuestionKind =
  | 'freeText'
  | 'singleSelect'
  | 'multiSelect'
  | 'dropdown'
  | 'choice';

export interface CopilotQuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface CopilotQuestionEvent {
  id: string;
  prompt: string;
  kind: CopilotQuestionKind;
  /**
   * Structured options for select/dropdown kinds. Legacy `choice` questions
   * may carry a bare `string[]`; both ends upgrade those to `{id,label}`.
   */
  options?: CopilotQuestionOption[] | string[];
  /** Show an "add your own" free-text entry alongside the options. */
  allowCustom?: boolean;
  /** Render a synthetic "None of these" choice. */
  allowNone?: boolean;
  /** Minimum selections before the trainer can confirm (e.g. 1 for languages). */
  minSelections?: number;
  /** Maximum selections allowed (omit for unlimited). */
  maxSelections?: number;
}

export interface CopilotBehaviourReviewItem {
  id: string;
  name: string;
  checked: boolean;
}

/**
 * review_behaviours payload: two polarity groups (helpful / unhelpful),
 * pre-checked from the selected competencies' mapped behaviours. The trainer
 * toggles items and may add custom ones per group; the confirmed set becomes
 * the spec rubric.
 */
export interface CopilotBehaviourReviewEvent {
  id: string;
  prompt: string;
  helpful: CopilotBehaviourReviewItem[];
  unhelpful: CopilotBehaviourReviewItem[];
  allowCustom?: boolean;
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
