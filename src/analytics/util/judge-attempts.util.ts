import {
  JUDGE_MAX_ATTEMPTS,
  JUDGE_RETRY_AFTER_MINUTES,
  JudgeAttemptFamily,
} from '../constants/judge-scheduling.constants';

/**
 * How a SCHEDULED judge run narrows its selection. Admin-triggered backfills
 * (the analytics controller's `.../backfill` endpoints) pass none of this, and
 * that is deliberate — see `honourAttemptLedger`.
 */
export interface ScheduledSelection {
  /**
   * Skip subjects the attempt ledger has given up on (JUDGE_MAX_ATTEMPTS) or
   * is still backing off (JUDGE_RETRY_AFTER_MINUTES).
   *
   * Only the 30-minute catch-ups and the backlog drainer set it. A manual
   * backfill leaves it off, so an operator can recover subjects that hit the
   * cap during a provider outage just by re-running the backfill — a success
   * then clears their ledger rows. Failures on a manual run are still
   * recorded: they cost the same.
   */
  honourAttemptLedger?: boolean;
  /**
   * Leave sessions created within the last N hours alone, because a live
   * catch-up owns them. See CATCHUP_HANDOFF_MARGIN_HOURS.
   */
  excludeCreatedWithinHours?: number | null;
}

/**
 * `NOT EXISTS` fragment that drops subjects the ledger says not to try yet:
 * attempts exhausted, or the last failure too recent to retry.
 *
 * `subjectExpr` is the uuid the family's ledger rows are keyed by — the
 * session id, or the recall selection id for the per-turn family. `p` is the
 * caller's positional-parameter helper, so the fragment numbers its own
 * placeholders in line with the rest of the query.
 *
 * Probed through the unique (family, subjectId) index, so it costs one index
 * lookup per candidate.
 */
export function judgeAttemptGate(
  family: JudgeAttemptFamily,
  subjectExpr: string,
  p: (v: unknown) => string,
): string {
  return `NOT EXISTS (
             SELECT 1 FROM judge_attempts ja
              WHERE ja.family = ${p(family)}
                AND ja."subjectId" = ${subjectExpr}
                AND (ja.attempts >= ${p(JUDGE_MAX_ATTEMPTS)}
                     OR ja."lastAttemptAt" > now() - make_interval(mins => ${p(
                       JUDGE_RETRY_AFTER_MINUTES,
                     )})))`;
}

/**
 * A short, PHI-free label for why a judge call failed — what the ledger
 * stores in `lastError`.
 *
 * Built from the error's SHAPE, never its message. Most messages are harmless
 * ("timeout of 600000ms exceeded"), but a driver error can echo the value it
 * rejected, and that value can be transcript text or a model's quote of it.
 * The full message still goes to the service log line that already records
 * each failure; the table only needs enough to group failures by cause.
 */
export function describeJudgeFailure(e: unknown): string {
  const err = (e ?? {}) as {
    isAxiosError?: boolean;
    code?: unknown;
    name?: unknown;
    response?: { status?: unknown };
    driverError?: { code?: unknown };
  };
  const code = typeof err.code === 'string' ? err.code : undefined;
  if (err.isAxiosError) {
    const status = err.response?.status;
    if (typeof status === 'number') return `http ${status}`;
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
      return `timeout (${code})`;
    }
    return `network ${code ?? 'error'}`;
  }
  const name = typeof err.name === 'string' && err.name ? err.name : 'Error';
  // Postgres SQLSTATE (e.g. 23505) — a code, never data.
  const sqlState =
    typeof err.driverError?.code === 'string' ? err.driverError.code : code;
  return (sqlState ? `${name} ${sqlState}` : name).slice(0, 120);
}
