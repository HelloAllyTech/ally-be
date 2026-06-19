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
