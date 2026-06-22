/**
 * Immutable configuration captured when a Copilot run is created. Mirrors the
 * inputs the superadmin supplied (brief / skill / model) plus the auto-resolved
 * defaults (competency, language, voice) the orchestrator picked at start.
 */
export type CopilotRunConfig = {
  /** Original free-text actor brief from the superadmin. */
  brief: string;
  /** promptCode of the selected main-agent prompt variant ("skill"). */
  skillPromptCode?: string;
  /** Model id the field-generation calls run on (e.g. gpt-4o, claude-sonnet-4-6). */
  model?: string;
  /** Provider derived from the model id. */
  provider: 'openai' | 'anthropic';
  /** Auto-resolved language id used for the draft + practice conversation. */
  languageId: number;
  /** BCP-47 code of the language (e.g. en-IN). */
  languageCode: string;
  /** Auto-resolved voice id written into the draft's languageVoices. */
  voiceId: string;
  /** Auto-selected competency id (LLM pick from the catalog). */
  competencyId?: string;
  /** Competency name (for generation context + display). */
  competencyName?: string;
  /** Max counselor turns in the practice conversation. */
  turns: number;
  /**
   * Tenant id captured from the creating user's execution context at start.
   * Background rounds (triggered by the webhook, which has no user context)
   * re-establish the owner's auth context using createdBy + this tenantId so
   * scenario updates / report creation authorize correctly.
   */
  tenantId?: string;
  /**
   * Conversation segment for the live feed: 0 for the original build, +1 per
   * `/revise` turn. Lets the chat UI render each revision as a new chapter.
   */
  segment?: number;
  /**
   * Free-text revise instruction from the superadmin. When set, it is folded
   * into the round-1 refinement context (same channel as round-≥2 feedback).
   */
  reviseInstruction?: string;
};

/**
 * One entry in a run's append-only activity feed (`progressLog`). Small,
 * PII-safe structured events the Claude-Coding-style chat UI renders as it
 * polls the run. Carries identifiers + numbers only — never field prose or
 * transcript bodies.
 */
export type CopilotProgressEventKind =
  | 'run_started'
  | 'draft_provisioned'
  | 'round_started'
  | 'base_generation'
  | 'field_generation'
  | 'tier_completed'
  | 'generation_completed'
  | 'evaluation_started'
  | 'round_scored'
  | 'refining'
  | 'revise_requested'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type CopilotProgressEventStatus =
  | 'started'
  | 'completed'
  | 'skipped'
  | 'failed'
  | 'info';

export type CopilotProgressEvent = {
  /** Stable uuid so the FE can key/dedupe. */
  id: string;
  /** Monotonic 0-based ordinal across the whole run; the FE diffs on this. */
  seq: number;
  /** ISO timestamp. */
  at: string;
  /** Which generate→converse→evaluate round this belongs to (0 for setup). */
  round: number;
  /** Conversation segment (0 = original build, +1 per revise turn). */
  segment: number;
  kind: CopilotProgressEventKind;
  status: CopilotProgressEventStatus;
  /** Short human label, e.g. "Generating behavior instructions". PII-safe. */
  label: string;
  /** Small structured extras — never prose / transcript bodies. */
  payload?: {
    /** GeneratableField value for field_generation events. */
    fieldName?: string;
    /** Tier index for tier_completed events. */
    tier?: number;
    /** Composite score (0-100) for round_scored. */
    score?: number | null;
    /** Per-metric LLM-judge scores for round_scored. */
    metrics?: Record<string, number>;
    /** scenario-report id — links the FE to the transcript / eval side panel. */
    reportId?: string;
    /** Truncated failure / skip reason (<= 200 chars). */
    reason?: string;
  };
};

/**
 * One generate -> converse -> evaluate round, recorded for the transparency UI
 * and to feed the next round's refinement.
 */
export type CopilotRoundHistoryEntry = {
  round: number;
  /** Composite score (mean of metrics), 0-100. Null while still evaluating. */
  score: number | null;
  /** Raw per-metric scores from the LLM judge. */
  metrics?: Record<string, number>;
  /** Full markdown evaluation report (the human-readable recommendations). */
  reportMarkdown?: string;
  /** The generated field values applied this round (keyed by field id). */
  fieldValues?: Record<string, unknown>;
  /** The scenario-report id that scored this round. */
  reportId?: string;
};
