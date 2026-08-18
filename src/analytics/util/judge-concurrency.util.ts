/**
 * Bounded-concurrency runner for the judge backfills.
 *
 * The three backfills were a plain `for (const s of sessions) { await … }`,
 * which meant one session in flight at a time while an LLM call dominates each
 * iteration. Measured against production: ~80s per session, so a 90-day window
 * of ~2,000 sessions ran for the better part of two days — long enough that an
 * ordinary deploy interrupting it was the expected path rather than an edge
 * case, since the loop lives in the API process.
 *
 * A worker pool rather than `Promise.all` over everything: the point is to keep
 * a fixed number of calls in flight, not to open two thousand at once. Workers
 * pull from a shared cursor, so a slow session delays only its own worker and
 * the pool stays saturated — which a chunked "run 5, wait for all 5, run the
 * next 5" loop does not do, as each chunk runs at the speed of its slowest
 * member.
 *
 * `task` must handle its own failures. A rejection here would abandon that
 * worker and shrink the pool for the rest of the run; all three callers already
 * wrap each session in try/catch precisely so one bad session cannot end the
 * job, and that contract is asserted rather than assumed — see the throw below.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        await task(items[index], index);
      } catch (e) {
        // The callers swallow per-item errors themselves. Reaching here means
        // one didn't, and silently continuing would let a whole job report
        // "done" over work that never ran.
        throw new Error(
          `judge backfill task threw for item ${index}; per-item errors must be ` +
            `handled by the caller: ${(e as Error).message}`,
        );
      }
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));
}

/**
 * Sessions judged in parallel per backfill.
 *
 * Five, not more, and the ceiling is deliberate. ally-ai's own semaphore sits at
 * 4,500 so it is not the constraint; the real limits are the Gemini rate limit
 * shared by every judge and the single core-ai task all of this funnels
 * through. A backfill is background work — it must not be able to starve the
 * live paths that share those limits, and a 429 storm would convert throughput
 * into failed sessions that a later re-run has to pick up anyway.
 */
export const DEFAULT_JUDGE_CONCURRENCY = 5;
export const MAX_JUDGE_CONCURRENCY = 20;

/** Clamp a caller-supplied concurrency into the safe band. */
export function resolveJudgeConcurrency(requested?: number | null): number {
  if (!requested || !Number.isFinite(requested)) {
    return DEFAULT_JUDGE_CONCURRENCY;
  }
  return Math.max(1, Math.min(Math.trunc(requested), MAX_JUDGE_CONCURRENCY));
}
