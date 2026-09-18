/**
 * A GLOBAL ceiling on ADMIN REPORTING queries in flight, across every read.
 *
 * The reporting reads fan out hard: the actor-quality tab issues 26 queries in a
 * single `Promise.all`, the session-log detail 17, highlights 12, and several
 * others 7-10. Each is one pooled connection held for the duration, against a
 * pool of `max: 30` per process — so ONE actor-quality request can claim most of
 * a task's pool, and two arriving together can claim all of it. What that
 * starves is not other charts but the live paths sharing the pool: on 2026-09-03
 * a single admin opening this page drove prod connections from a steady 26 to 76
 * and timed out `users/me/preferences`, `tooltips/active` and Scribe's
 * `chats/:id/messages` at the 30s statement timeout, alongside a hard
 * `remaining connection slots are reserved for ... superuser` from RDS.
 *
 * WHAT BELONGS BEHIND THIS GATE: super-admin reporting reads, where a second of
 * extra latency costs nothing and the alternative is starving someone's live
 * request. What does NOT: the per-review reads in `scenario-session-review` and
 * `scribe-session-review`. Those fan out 6-7 wide, which is modest, and they are
 * point lookups by id on a path a real user is waiting on — putting them behind
 * a reporting ceiling would let a dashboard stall a reviewer's page, which moves
 * the queue rather than removing it. Widen the gate's membership only within the
 * workload class it is named for.
 *
 * A slot gate rather than chunked `Promise.all` batches, for two reasons. It
 * keeps a fixed number in flight instead of running at the speed of each
 * chunk's slowest member — the same argument `runWithConcurrency` is built on.
 * And it is PROCESS-GLOBAL, so it bounds concurrent REQUESTS too: two readers
 * loading two tabs share this ceiling, which per-request batching cannot do,
 * and concurrent readers were exactly the shape that exhausted the pool.
 *
 * Each call keeps its own return type, unlike a generic bounded `map` over a
 * heterogeneous list, so callers wrap in place and the tuple destructuring at
 * the call site is untouched.
 */
const reportingQuerySlots = {
  /**
   * Eight, against a pool of 30 per process.
   *
   * The reserve is the point: 22 connections stay available for the live paths
   * — sessions, chats, preferences — that share this pool and that a reporting
   * page must never be able to starve. Reporting reads are the one workload
   * here where a second of extra latency costs nothing, and the actor-quality
   * response is cached for five minutes on top.
   *
   * Raise it only alongside `DB_POOL_MAX` and only with the live paths' headroom
   * recomputed, not because a chart felt slow: the failure this prevents shows
   * up as unrelated endpoints timing out, which is not a symptom anyone traces
   * back to a chart.
   */
  limit: 8,
  inUse: 0,
  waiting: [] as Array<() => void>,
};

/**
 * Run `fn` holding one of the global reporting query slots.
 *
 * Release HANDS THE SLOT OVER to the next waiter rather than decrementing and
 * waking it: decrementing first opens a window between the wake-up and the
 * waiter actually resuming, and a fresh caller arriving in that window sees a
 * free slot and takes it — so the limit is briefly exceeded by however many
 * callers barge in. Transferring ownership keeps `inUse` honest at every
 * instant.
 *
 * The slot is released on failure as well as success. A query that throws
 * (a statement timeout, say) must not retire a slot permanently — that is how a
 * transient database problem becomes a process that serves nothing until it is
 * restarted.
 */
export async function withReportingQuerySlot<T>(
  fn: () => Promise<T>,
): Promise<T> {
  if (reportingQuerySlots.inUse < reportingQuerySlots.limit) {
    reportingQuerySlots.inUse += 1;
  } else {
    // Resuming means the slot is already ours — `inUse` was never given back.
    await new Promise<void>((resolve) =>
      reportingQuerySlots.waiting.push(resolve),
    );
  }

  try {
    return await fn();
  } finally {
    const next = reportingQuerySlots.waiting.shift();
    if (next) {
      next();
    } else {
      reportingQuerySlots.inUse -= 1;
    }
  }
}

/** Test seam: reporting queries in flight right now, across every read. */
export function reportingQuerySlotsInUse(): number {
  return reportingQuerySlots.inUse;
}

/** Test seam: the global ceiling, so a test cannot drift from the constant. */
export const REPORTING_QUERY_SLOT_LIMIT = reportingQuerySlots.limit;
