/**
 * SSE contract for
 * POST /v1/builder/sessions/:sessionId/messages/stream
 * (text/event-stream; each frame is `event: <name>\ndata: <json>\n\n`).
 *
 * Treat this as frozen. It mirrors the copilot / character-interview contract
 * (token / tool_call / tool_result / question / error / done / ping) with two
 * Builder additions:
 *
 *  - `prd_draft` — the full PRD after an update_prd patch lands, so the doc
 *    panel re-renders mid-turn rather than after it;
 *  - `readiness` — the recomputed rubric, ridden alongside prd_draft so the
 *    readiness ring and the "Start build" button never lag the document;
 *  - `receipt` — once per turn, just before `done`: what the turn read,
 *    searched, changed in the PRD and what failed (BuilderTurnReceipt).
 *
 * Both are emitted at tool-execution time, which is also when the patch is
 * persisted: an aborted turn keeps the work it already did.
 */
export type BuilderSseEventName =
  | 'token'
  | 'tool_call'
  | 'tool_result'
  | 'question'
  | 'prd_draft'
  | 'readiness'
  | 'receipt'
  // The opening turn's situation brief (builder_settings.situationBrief): the
  // card the admin confirms or corrects line by line.
  | 'situation_brief'
  | 'error'
  | 'done'
  // Keep-alive written by the stream controller every ~15s; clients ignore it.
  | 'ping';

export interface BuilderSseFrame {
  event: BuilderSseEventName;
  data: Record<string, any>;
}

/**
 * Question kinds — identical to the copilot's so the admin app reuses one
 * QuestionCard widget across the interview AND mid-build pauses.
 */
export type BuilderQuestionKind =
  | 'freeText'
  | 'singleSelect'
  | 'multiSelect'
  | 'dropdown';

export interface BuilderQuestionOption {
  id: string;
  label: string;
  /** The trade-off, in one line. This is what makes an option pickable. */
  description?: string;
  /** Exactly one option may carry this; the UI focuses it for one-key answering. */
  recommended?: boolean;
}

export interface BuilderQuestionEvent {
  id: string;
  prompt: string;
  kind: BuilderQuestionKind;
  options?: BuilderQuestionOption[];
  /** Show an "add your own" free-text entry. Effectively always on. */
  allowCustom?: boolean;
  /** Render a synthetic "None of these" choice. */
  allowNone?: boolean;
  minSelections?: number;
  maxSelections?: number;
  /**
   * Why this is being asked — a contradiction being resolved, an assumption
   * being checked. Rendered as a subtitle so the admin can tell a
   * clarification from a fresh line of enquiry.
   */
  rationale?: string;
}

export interface BuilderDoneEvent {
  messageSeq: number;
  sessionStatus: string;
}

/**
 * What a turn did, built by the server from the tool results and the PRD
 * diff — never from the model's account of itself.
 *
 * Every line is composed for display. Persisted on the assistant row as
 * `metadata.receipt`, sent as the `receipt` frame, rendered under the reply,
 * exported with the transcript, and replayed into the history summary so a
 * failure cannot drop out of the record once the interview grows long.
 */
export interface BuilderTurnReceipt {
  /** Files and pages read: "ally-be/src/builder/x.ts", "wiki/platform/architecture.md". */
  read: string[];
  /** Searches and lookups, with what came back: 'Code search "rating" — 4 matches'. */
  searched: string[];
  /** What changed in the PRD, by section, requirement id and repo name. */
  changed: string[];
  /** PRD version before and after the turn; equal when nothing changed. */
  prdVersion: { from: number; to: number };
  /** Lookups and edits that failed: what was attempted, and why. */
  failed: string[];
  /** What the reply was delivered with anyway, after the turn's retries ran out. */
  warnings: string[];
  /** Builder's stated reason the PRD did not move after the admin's own words. */
  prdUnchangedBecause?: string | null;
}

/** What a tool execution hands back to the orchestrator loop. */
export interface BuilderToolExecutionOutcome {
  /** JSON-serialised into the tool_result block returned to the model. */
  modelResult: Record<string, any>;
  /** One-line human summary for the tool_result SSE frame. */
  summary: string;
  /** Extra SSE frames emitted BEFORE the tool_result frame. */
  events?: BuilderSseFrame[];
  /** True ends the tool loop after this call (ask_admin). */
  endTurn?: boolean;
}
