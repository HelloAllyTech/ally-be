/**
 * SSE contract for
 * POST /v1/scenario-characters/interview/sessions/:id/messages/stream
 * (text/event-stream; each frame is `event: <name>\ndata: <json>\n\n`).
 *
 * Mirrors the Roleplay Studio copilot contract (token / tool_call /
 * tool_result / question / error / done / ping) with one addition:
 * `character_draft` carries the finished profile when the agent calls
 * save_character_draft, so the client can open the review form.
 */
export type CharacterInterviewSseEventName =
  | 'token'
  | 'tool_call'
  | 'tool_result'
  | 'question'
  | 'character_draft'
  | 'error'
  | 'done'
  // Keep-alive written by the stream controller every ~15s; clients ignore it.
  | 'ping';

export interface CharacterInterviewSseFrame {
  event: CharacterInterviewSseEventName;
  data: Record<string, any>;
}

/**
 * Interactive question kinds — identical to the copilot's so the admin app
 * reuses the same QuestionCard widget.
 */
export type CharacterInterviewQuestionKind =
  | 'freeText'
  | 'singleSelect'
  | 'multiSelect'
  | 'dropdown';

export interface CharacterInterviewQuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface CharacterInterviewQuestionEvent {
  id: string;
  prompt: string;
  kind: CharacterInterviewQuestionKind;
  options?: CharacterInterviewQuestionOption[];
  /** Show an "add your own" free-text entry alongside the options. */
  allowCustom?: boolean;
  /** Render a synthetic "None of these" choice. */
  allowNone?: boolean;
  minSelections?: number;
  maxSelections?: number;
}

/** save_character_draft payload — ScenarioCharacterRequestDto shape. */
export interface CharacterDraftEvent {
  draft: Record<string, any>;
}

export interface CharacterInterviewDoneEvent {
  messageSeq: number;
  /** Session status after the turn (COMPLETED once the draft was produced). */
  sessionStatus: string;
}

/** What a tool execution hands back to the orchestrator loop. */
export interface InterviewToolExecutionOutcome {
  /** JSON-serialised into the tool_result block returned to the model. */
  modelResult: Record<string, any>;
  /** One-line human summary for the tool_result SSE frame. */
  summary: string;
  /** Extra SSE frames to emit BEFORE the tool_result frame. */
  events?: CharacterInterviewSseFrame[];
  /** True ends the tool loop after this call (ask_question, save_character_draft). */
  endTurn?: boolean;
}
