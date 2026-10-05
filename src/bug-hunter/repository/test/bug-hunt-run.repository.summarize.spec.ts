import { DataSource } from 'typeorm';

import { BugHuntRunRepository } from '../bug-hunt-run.repository';
import { BugHuntRunStatus } from '../../enum/bug-hunt-run.enum';

/**
 * `summarize` and `dailySeries` feed the admin scorecard, which replaced a
 * browser-side sum over the newest 50 runs. The properties worth pinning are
 * the ones that made that sum wrong: the window is applied in SQL (or not at
 * all for "all time"), every figure is read back as a number, and an empty
 * table yields zeros rather than NaN.
 */
const build = () => {
  const query = jest.fn();
  const repo = new BugHuntRunRepository({
    createEntityManager: () => ({ query }),
  } as unknown as DataSource);
  return { repo, query };
};

describe('BugHuntRunRepository.summarize', () => {
  it('passes the window start and the status names as parameters', async () => {
    const { repo, query } = build();
    query.mockResolvedValue([]);
    const since = new Date('2026-09-05T00:00:00.000Z');

    await repo.summarize(since);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('r."createdAt" >= $1');
    expect(params).toEqual([
      since,
      BugHuntRunStatus.COMPLETED,
      BugHuntRunStatus.FAILED,
      BugHuntRunStatus.RUNNING,
      BugHuntRunStatus.SKIPPED_DISABLED,
      BugHuntRunStatus.SKIPPED_QUIET,
    ]);
  });

  it('totals all time when no window is given', async () => {
    const { repo, query } = build();
    query.mockResolvedValue([]);

    await repo.summarize(null);

    const [sql, params] = query.mock.calls[0];
    expect(params[0]).toBeNull();
    expect(sql).toContain('$1::timestamp IS NULL OR');
  });

  it('prefers the CLI-reported cost over the token estimate, like the shift log', async () => {
    const { repo, query } = build();
    query.mockResolvedValue([]);
    await repo.summarize(null);
    const [sql] = query.mock.calls[0];
    expect(sql).toContain(
      "NULLIF((r.metadata->>'cliReportedCostUsd'), '')::numeric",
    );
    expect(sql).toContain('r."totalTokenCostUsd"');
  });

  it('reads every Postgres string back as a number', async () => {
    const { repo, query } = build();
    query.mockResolvedValue([
      {
        runs: '52',
        cost_usd: '131.2500',
        completed: '46',
        failed: '1',
        running: '2',
        skipped: '3',
        found: '57',
        auto_merged: '5',
        pr_opened: '27',
        dismissed: '9',
        input_tokens: '1200000',
        output_tokens: '84000',
        tokens_reported: '40',
      },
    ]);

    await expect(repo.summarize(null)).resolves.toEqual({
      runs: 52,
      costUsd: 131.25,
      completed: 46,
      failed: 1,
      running: 2,
      skipped: 3,
      found: 57,
      autoMerged: 5,
      prOpened: 27,
      dismissed: 9,
      inputTokens: 1_200_000,
      outputTokens: 84_000,
      tokensReported: 40,
    });
  });

  it('yields zeros, not NaN, for an empty table', async () => {
    const { repo, query } = build();
    query.mockResolvedValue([]);
    const summary = await repo.summarize(null);
    expect(Object.values(summary).every((v) => v === 0)).toBe(true);
  });
});

describe('BugHuntRunRepository.dailySeries', () => {
  it('buckets by the given zone over the given number of days', async () => {
    const { repo, query } = build();
    query.mockResolvedValue([
      { day: '2026-10-04', runs: '0', cost_usd: '0', found: '0' },
      { day: '2026-10-05', runs: '5', cost_usd: '12.5', found: '7' },
    ]);

    const series = await repo.dailySeries(14, 'Asia/Kolkata');

    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual(['Asia/Kolkata', 14]);
    // Naive UTC column → the reader's zone, then the calendar day.
    expect(sql).toContain(`AT TIME ZONE 'UTC' AT TIME ZONE $1`);
    expect(sql).toContain('generate_series');
    expect(series).toEqual([
      { date: '2026-10-04', runs: 0, costUsd: 0, found: 0 },
      { date: '2026-10-05', runs: 5, costUsd: 12.5, found: 7 },
    ]);
  });
});
