import {
  DEFAULT_JUDGE_CONCURRENCY,
  MAX_JUDGE_CONCURRENCY,
  resolveJudgeConcurrency,
  runWithConcurrency,
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
