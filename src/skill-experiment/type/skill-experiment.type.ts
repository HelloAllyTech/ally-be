/**
 * One rubric criterion the judge scores 1–5. `key` is the stable id the judge
 * answers under; `name`/`description` are what the judge (and admin) read.
 */
export interface RubricCriterion {
  key: string;
  name: string;
  description: string;
  /** Relative weight in the overall score, 1–5. */
  weight: number;
}

/**
 * The output shape the champion's outputs established, so a challenger that
 * breaks the call site's parser is caught deterministically rather than left
 * to the judge's taste. `json` carries the top-level keys every champion
 * output had.
 */
export type SkillOutputShape =
  | { kind: 'json'; requiredKeys: string[] }
  | { kind: 'text' };

/** Per-criterion verdict stored on an observation. */
export type CriterionVerdicts = Record<
  string,
  { score: number; reason: string }
>;

/**
 * Which arm served one execution of a skill. Returned by
 * `SkillExperimentRouterService.assign` and handed back to `record`.
 */
export interface SkillArm {
  experimentId: string;
  variantId: string;
  promptCode: string;
  /**
   * The text this execution must use. Always set — the original arm carries
   * the experiment's snapshot of the skill text, so both arms of a comparison
   * are exactly the text the experiment thinks they are.
   */
  content: string;
  isOriginal: boolean;
  /** False while paused: the champion serves, but nothing more is collected. */
  record: boolean;
}

/** What a call site reports after an execution. */
export interface SkillOutputReport {
  /** The data the skill ran on (template variables or request payload). */
  input: Record<string, unknown>;
  /** The skill's output, verbatim. Omit when the call failed. */
  output?: string;
  /** Set when the call failed (provider error, unparsable reply). */
  error?: string;
  tenantId?: string | null;
}
