/**
 * Where a skill's auto-improve loop is. Each value is guarded by a CHECK
 * constraint (see the CreateSkillExperiments migration) and listed in
 * `check-constraints-cover-enums.spec.ts` — add a value in all three places.
 *
 *  - OFF       — the skill serves its own text; nothing is recorded.
 *  - BASELINE  — the original text serves 100% while its outputs are judged,
 *                until there are enough to compare against.
 *  - TESTING   — the champion serves most traffic and one challenger the rest.
 *  - PAUSED    — the loop stopped (target reached, budget spent, no progress);
 *                the champion serves 100% until an admin applies, resumes or
 *                stops it.
 */
export enum SkillExperimentStatus {
  OFF = 'off',
  BASELINE = 'baseline',
  TESTING = 'testing',
  PAUSED = 'paused',
}

/** Why the loop paused — what the admin is shown first. */
export enum SkillExperimentPauseReason {
  /** The champion reached the target score. */
  TARGET_REACHED = 'target_reached',
  /** The original already met the target before any variant was drafted. */
  BASELINE_MEETS_TARGET = 'baseline_meets_target',
  /** The variant budget for this run is spent. */
  MAX_VARIANTS = 'max_variants',
  /** Too many challengers in a row failed to beat the champion. */
  NO_PROGRESS = 'no_progress',
  /** The designer could not produce a draft that passed validation. */
  DESIGNER_FAILED = 'designer_failed',
}

export enum SkillVariantStatus {
  /** Serving the majority (or all) of traffic. Exactly one per live run. */
  CHAMPION = 'champion',
  /** Serving the experiment share against the champion. At most one. */
  CHALLENGER = 'challenger',
  /** Served traffic once and lost, or its run ended. */
  RETIRED = 'retired',
  /** Drafted but failed validation — never served anyone. */
  REJECTED = 'rejected',
}

export enum SkillObservationStatus {
  /** Recorded, waiting for the judge. */
  PENDING = 'pending',
  /** Scored (including a deterministic 0 for a broken or failed output). */
  JUDGED = 'judged',
  /** The judge failed on every attempt; excluded from the stats. */
  FAILED = 'failed',
}

export enum SkillExperimentEventType {
  CONFIGURED = 'configured',
  STARTED = 'started',
  STOPPED = 'stopped',
  BASELINE_READY = 'baseline_ready',
  VARIANT_LAUNCHED = 'variant_launched',
  VARIANT_REJECTED = 'variant_rejected',
  VARIANT_RETIRED = 'variant_retired',
  CHAMPION_CHANGED = 'champion_changed',
  PAUSED = 'paused',
  RESUMED = 'resumed',
  RESET = 'reset',
  APPLIED = 'applied',
  ERROR = 'error',
}
