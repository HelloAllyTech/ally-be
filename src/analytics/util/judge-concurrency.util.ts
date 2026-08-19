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

/**
 * How long ally-be waits for a judge call to ally-ai.
 *
 * Measured in production over 27 completed judge calls: median 59s, max 234s,
 * and 4 of 27 already past the old 120s ceiling while core-ai sat idle. Every
 * one of those was a Gemini call we paid for, threw away, and counted as
 * `processed` — the failure was invisible because the counter did not
 * distinguish it from work that succeeded.
 *
 * 600s is headroom over the observed tail, not a target. It is not a fix for
 * the underlying shape: a synchronous HTTP request for work that takes minutes
 * is the wrong transport, and if backfills become routine the honest answer is
 * a queue or Gemini's batch API. Raising this again is a signal to do that
 * instead.
 */
export const JUDGE_HTTP_TIMEOUT_MS = 600_000;

/**
 * A GLOBAL ceiling on judge calls in flight, across every backfill at once.
 *
 * The per-job `concurrency` cannot bound load on a shared resource: three jobs
 * at 5 each meant 15 concurrent calls into one core-ai task, which pegged it at
 * 100% CPU (2% at rest) and inflated every call past its timeout — a full run
 * that judged nothing. A per-job limit only ever describes one job's appetite;
 * this describes what the judge can actually absorb.
 *
 * Held here rather than written down as "run them one at a time", because an
 * operational rule that must be remembered is one that will eventually be
 * forgotten at 2am.
 */
const globalJudgeSlots = {
  // Six, because this ceiling is PER PROCESS and ally-be runs two tasks — the
  // service actually puts twice this number in flight. Paired with core-ai
  // running two tasks, twelve concurrent calls land as six per task, which is
  // exactly the per-task pressure core-ai already absorbed at limit 3 on one
  // task. Throughput doubles; what any single judge task has to survive does
  // not change.
  //
  // Raise this only alongside core-ai's task count, and watch the `failed`
  // counters on the next tick: past this point the binding constraint stops
  // being core-ai's CPU and becomes the Gemini rate limit shared with the live
  // paths, where the failure mode is a 429 storm that converts throughput into
  // sessions a later run has to redo.
  limit: 6,
  inUse: 0,
  waiting: [] as Array<() => void>,
};

/**
 * Run `fn` holding one of the global judge slots.
 *
 * Release HANDS THE SLOT OVER to the next waiter rather than decrementing and
 * waking it: decrementing first opens a window between the wake-up and the
 * waiter actually resuming, and a fresh caller arriving in that window sees a
 * free slot and takes it — so the limit is briefly exceeded by however many
 * callers barge in. Transferring ownership keeps `inUse` honest at every
 * instant.
 */
export async function withJudgeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (globalJudgeSlots.inUse < globalJudgeSlots.limit) {
    globalJudgeSlots.inUse += 1;
  } else {
    // Resuming means the slot is already ours — `inUse` was never given back.
    await new Promise<void>((resolve) =>
      globalJudgeSlots.waiting.push(resolve),
    );
  }

  try {
    return await fn();
  } finally {
    const next = globalJudgeSlots.waiting.shift();
    if (next) {
      next();
    } else {
      globalJudgeSlots.inUse -= 1;
    }
  }
}

/** Test seam: judge calls in flight right now, across every backfill. */
export function judgeSlotsInUse(): number {
  return globalJudgeSlots.inUse;
}

/** Test seam: the global ceiling, so a test cannot drift from the constant. */
export const GLOBAL_JUDGE_SLOT_LIMIT = globalJudgeSlots.limit;
