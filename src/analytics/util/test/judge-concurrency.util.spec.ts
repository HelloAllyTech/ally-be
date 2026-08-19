import {
  DEFAULT_JUDGE_CONCURRENCY,
  GLOBAL_JUDGE_SLOT_LIMIT,
  judgeSlotsInUse,
  MAX_JUDGE_CONCURRENCY,
  resolveJudgeConcurrency,
  runWithConcurrency,
  withJudgeSlot,
} from '../judge-concurrency.util';

/**
 * The pool exists to make a two-day backfill finish in hours. Three things have
 * to hold, and none of them are visible in a typecheck: every item runs exactly
 * once, no more than `concurrency` run at a time, and a slow item does not
 * stall the others.
 */
describe('runWithConcurrency', () => {
  it('runs every item exactly once', async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const seen: number[] = [];

    await runWithConcurrency(items, 5, async (item) => {
      seen.push(item);
    });

    expect(seen).toHaveLength(50);
    expect(new Set(seen).size).toBe(50);
  });

  it('never exceeds the requested concurrency', async () => {
    let inFlight = 0;
    let peak = 0;

    await runWithConcurrency(Array.from({ length: 40 }), 5, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
    });

    expect(peak).toBe(5);
  });

  it('keeps the pool saturated when one item is slow', async () => {
    // The reason this is a worker pool and not a chunked "run 5, await all 5"
    // loop: with chunking, one slow item idles four workers for its whole
    // duration. Here the fast items keep flowing past it.
    const durations = [200, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const completed: number[] = [];

    await runWithConcurrency(durations, 2, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      completed.push(i);
    });

    // The slow first item finishes last despite starting first.
    expect(completed[completed.length - 1]).toBe(0);
    expect(completed).toHaveLength(10);
  });

  it('does not open more workers than there are items', async () => {
    let peak = 0;
    let inFlight = 0;

    await runWithConcurrency([1, 2], 10, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
    });

    expect(peak).toBe(2);
  });

  it('surfaces a task that throws instead of silently shrinking the pool', async () => {
    // Callers must swallow their own per-item errors. If one ever stops doing
    // that, the job must fail loudly rather than report "done" over work that
    // never ran.
    await expect(
      runWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
      }),
    ).rejects.toThrow(/must be handled by the caller/);
  });

  it('is a no-op on an empty list', async () => {
    const task = jest.fn();
    await runWithConcurrency([], 5, task);
    expect(task).not.toHaveBeenCalled();
  });
});

describe('resolveJudgeConcurrency', () => {
  it('defaults when nothing is asked for', () => {
    expect(resolveJudgeConcurrency(undefined)).toBe(DEFAULT_JUDGE_CONCURRENCY);
    expect(resolveJudgeConcurrency(null)).toBe(DEFAULT_JUDGE_CONCURRENCY);
    expect(resolveJudgeConcurrency(0)).toBe(DEFAULT_JUDGE_CONCURRENCY);
  });

  it('caps a request that would starve the live paths', () => {
    // A backfill shares a Gemini rate limit and one core-ai task with live
    // traffic; "500" is not a throughput setting, it is an outage.
    expect(resolveJudgeConcurrency(500)).toBe(MAX_JUDGE_CONCURRENCY);
  });

  it('never drops below one, whatever is asked for', () => {
    expect(resolveJudgeConcurrency(-4)).toBe(1);
    expect(resolveJudgeConcurrency(0.5)).toBe(1);
  });

  it('honours a sane request', () => {
    expect(resolveJudgeConcurrency(8)).toBe(8);
  });
});

/**
 * The global slot limiter is what the per-job pool could not be: a ceiling on
 * everything hitting the judge at once. Three backfills at concurrency 5 each
 * put 15 calls into one core-ai task, pegged it at 100% CPU and pushed every
 * call past its timeout — a full run that judged nothing.
 */
describe('withJudgeSlot', () => {
  it('never lets more than the global limit run at once', async () => {
    let inFlight = 0;
    let peak = 0;

    // Three "jobs" pushing hard at the same time, as happened in production.
    await Promise.all(
      Array.from({ length: 30 }, () =>
        withJudgeSlot(async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 2));
          inFlight -= 1;
        }),
      ),
    );

    expect(peak).toBe(GLOBAL_JUDGE_SLOT_LIMIT);
  });

  it('does not let a fresh caller barge past a waiter', async () => {
    // The bug this guards: releasing by decrementing and then waking a waiter
    // leaves a window where a new arrival sees a free slot and takes it, so the
    // limit is exceeded by however many callers arrive in that window.
    let inFlight = 0;
    let peak = 0;
    const run = () =>
      withJudgeSlot(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
      });

    const first = Array.from({ length: GLOBAL_JUDGE_SLOT_LIMIT + 2 }, run);
    // Arrive late, exactly while the first batch is releasing.
    await new Promise((r) => setTimeout(r, 4));
    const late = Array.from({ length: 4 }, run);

    await Promise.all([...first, ...late]);
    expect(peak).toBe(GLOBAL_JUDGE_SLOT_LIMIT);
  });

  it('releases the slot when the call throws', async () => {
    await expect(
      withJudgeSlot(async () => {
        throw new Error('judge timed out');
      }),
    ).rejects.toThrow('judge timed out');

    // A leaked slot would silently shrink the ceiling for the rest of the run;
    // enough timeouts and the backfill would stall at zero throughput.
    expect(judgeSlotsInUse()).toBe(0);
  });

  it('returns the call result', async () => {
    await expect(withJudgeSlot(async () => 'judged')).resolves.toBe('judged');
  });
});
