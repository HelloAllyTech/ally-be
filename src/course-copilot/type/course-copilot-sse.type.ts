/**
 * SSE contract for
 * POST /v1/course-copilot/sessions/:sessionId/messages/stream
 * (text/event-stream; each frame is `event: <name>\ndata: <json>\n\n`).
 *
 * Frozen once the admin app ships against it. The first seven names are the
 * Builder / character-interview vocabulary, so the chat primitives are shared;
 * the rest are Course Copilot's own:
 *
 *  - `brief` — the full brief plus readiness after an update_brief lands;
 *  - `blueprint` — the full blueprint, its version, estimate and budget after
 *    propose_blueprint / update_blueprint;
 *  - `course_patch` — a one-line summary plus the compact outline after an
 *    edit-mode tool wrote the course;
 *  - `build_started` — an edit tool queued background jobs (a new roleplay,
 *    an image), so the client should start listening on the socket;
 *  - `receipt` — what the turn read, searched, changed and what failed,
 *    built by the server; once per turn, just before `done`.
 *
 * The first four are emitted at tool-execution time, which is also when the
 * change is persisted: an aborted turn keeps whatever it already did. In a
 * validated turn (`validated_agent_turns.courseCopilot`) the trainer's text
 * arrives as one `token` frame once the reply has been checked, and a
 * confirmation a tool raised is held until then.
 */
export type CourseCopilotSseEventName =
  | 'token'
  | 'tool_call'
  | 'tool_result'
  | 'question'
  | 'error'
  | 'done'
  | 'ping'
  | 'brief'
  | 'blueprint'
  | 'course_patch'
  | 'build_started'
  // What the turn read, changed and what failed; once per turn, just before `done`.
  | 'receipt';

export interface CourseCopilotSseFrame {
  event: CourseCopilotSseEventName;
  data: Record<string, any>;
}

/** Identical to Builder's, so the admin app renders one QuestionCard. */
export type CourseCopilotQuestionKind =
  | 'freeText'
  | 'singleSelect'
  | 'multiSelect'
  | 'dropdown';

export interface CourseCopilotQuestionOption {
  id: string;
  label: string;
  /** The trade-off, in one line. */
  description?: string;
  /** At most one option carries this. */
  recommended?: boolean;
}

export interface CourseCopilotQuestionEvent {
  id: string;
  prompt: string;
  kind: CourseCopilotQuestionKind;
  options?: CourseCopilotQuestionOption[];
  allowCustom?: boolean;
  allowNone?: boolean;
  minSelections?: number;
  maxSelections?: number;
  rationale?: string;
}

export interface CourseCopilotDoneEvent {
  messageSeq: number;
  sessionStatus: string;
  blueprintVersion?: number;
}

/** SSE error codes. The client branches on these, never on the copy. */
export const COURSE_COPILOT_ERROR_CODES = {
  MISCONFIGURED: 'copilot_misconfigured',
  TURN_IN_PROGRESS: 'turn_in_progress',
  SESSION_NOT_FOUND: 'session_not_found',
  PROVIDER_QUOTA_EXHAUSTED: 'provider_quota_exhausted',
  PROVIDER_AUTH_FAILED: 'provider_auth_failed',
  PROVIDER_RATE_LIMITED: 'provider_rate_limited',
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
  REQUEST_TOO_LARGE: 'request_too_large',
  RESPONSE_TRUNCATED: 'response_truncated',
  INVALID_TOOL_CALL: 'invalid_tool_call',
  EMPTY_TURN: 'empty_turn',
  NO_REPLY: 'no_reply',
  STRUCTURE_LOCKED: 'structure_locked',
  BUDGET_EXCEEDED: 'budget_exceeded',
  COPILOT_ERROR: 'copilot_error',
  STREAM_FAILED: 'stream_failed',
} as const;

/** What a tool execution hands back to the orchestrator loop. */
export interface CourseCopilotToolOutcome {
  /** JSON-serialised into the tool_result block returned to the model. */
  modelResult: Record<string, any>;
  /** One-line human summary for the tool_result SSE frame. */
  summary: string;
  /** Extra SSE frames emitted BEFORE the tool_result frame. */
  events?: CourseCopilotSseFrame[];
  /** True ends the tool loop after this call (ask_trainer, propose_blueprint). */
  endTurn?: boolean;
}
