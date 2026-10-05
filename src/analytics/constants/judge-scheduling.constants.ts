/**
 * The scheduled quality judges — drift, language, feedback groundedness and
 * recall — and the rules that keep them from paying twice for one answer, or
 * paying forever for none.
 *
 * Every judge call is a whole-transcript call to the pinned judge model,
 * roughly four cents a session, so "the same session judged twice" and "a
 * session that fails every thirty minutes for five months" are both line
 * items, not noise.
 */

/**
 * How far back each live catch-up looks. A day against a thirty-minute tick
 * gives generous overlap, so a skipped tick or a session that lands late is
 * still picked up — `onlyUnjudged` makes re-scanning the window free.
 */
export const DRIFT_CATCHUP_WINDOW_DAYS = 1;
export const LANGUAGE_CATCHUP_WINDOW_DAYS = 1;

/**
 * Extra distance the backlog drainer keeps from the language catch-up's
 * window, on top of the window itself.
 *
 * The two used to read the same newest-first sessions on the same tick, and
 * every new session was judged by both — `persistJudgment` deletes and
 * re-inserts, so the second call silently replaced the first and both were
 * billed. Partitioning by `createdAt` fixes that: the catch-up owns the last
 * day, the drainer owns everything older.
 *
 * The margin covers the one way a partition alone still lets them meet. A
 * catch-up run selects its whole window once, when it starts, and works
 * through it newest-first — so its OLDEST sessions are the last it reaches,
 * and they are exactly the ones ageing across the boundary while it works. A
 * run normally takes minutes; two hours of margin means the drainer can only
 * reach a session the catch-up selected if that run has been going for longer
 * than that. Nothing is lost by it: every session spends a full day in the
 * catch-up's window first, and the drainer is the backstop, not the path.
 */
export const CATCHUP_HANDOFF_MARGIN_HOURS = 2;

/**
 * Attempts before a scheduled judge gives up on a subject.
 *
 * Mirrors FHS_MAX_ATTEMPTS (foundational skills): three tries, then it is left
 * for a human. A judge failure that survives three tries an hour apart is a
 * property of the subject — a transcript the judge cannot finish inside its
 * timeout, a model that returns nothing for it — and retrying it on every
 * tick only buys the same failure again. The ally-ai side keeps running and
 * billing after ally-be's 600s timeout fires, so even a "timed out" attempt
 * was paid for.
 */
export const JUDGE_MAX_ATTEMPTS = 3;

/**
 * Minimum wait before a scheduled judge retries a subject that failed. Hourly,
 * as foundational skills retries: long enough to ride out a provider blip,
 * short enough that a transient failure still clears the same day.
 */
export const JUDGE_RETRY_AFTER_MINUTES = 60;

/**
 * Which judge an attempt ledger row belongs to. Values match the drainer's
 * Redis state keys (`judge:backlog:<family>`), so one name means one thing in
 * logs, Redis and the table.
 */
export enum JudgeAttemptFamily {
  DRIFT = 'drift',
  LANGUAGE = 'language',
  GROUNDEDNESS = 'groundedness',
  /** Per TURN: the subject is a `wm_recall_selections` row, not a session. */
  RECALL_QUALITY = 'recall-quality',
}

/** Why the last attempt produced no judgment. */
export enum JudgeAttemptOutcome {
  /** The call threw: HTTP error, timeout, or a failure persisting the result. */
  FAILED = 'failed',
  /**
   * The call answered but carried nothing to store — e.g. groundedness
   * returning 200 with no claims, or recall returning no verdict.
   */
  EMPTY = 'empty',
}
