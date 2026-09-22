import { DataSource } from 'typeorm';

import { PlatformAnalyticsRepository } from '../platform-analytics.repository';

/**
 * `getVoiceLatencyOverall` is the whole-window KPI counterpart to
 * `getVoiceLatencyByBucket` — it must run `percentile_cont` itself over every
 * matching turn, not fold the bucketed p50/p95 values together (percentiles do
 * not aggregate across buckets: there is no way to combine a set of p95s into
 * the p95 of the underlying turns).
 */
describe('PlatformAnalyticsRepository.getVoiceLatencyOverall', () => {
  const build = (rawRow: Record<string, unknown> | undefined) => {
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue(rawRow),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    const dataSource = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as DataSource;
    const repository = new PlatformAnalyticsRepository(dataSource);
    return { repository, qb };
  };

  const start = new Date('2026-08-01T00:00:00.000Z');
  const end = new Date('2026-09-01T00:00:00.000Z');

  it('computes avg/p50/p95 with percentile_cont, not a fold of the bucketed series', async () => {
    const { repository, qb } = build({
      turns: '5000',
      avgMs: '4700',
      p50Ms: '4300',
      p95Ms: '8100',
    });

    const result = await repository.getVoiceLatencyOverall(start, end);

    expect(result).toEqual({
      turns: 5000,
      avgMs: 4700,
      p50Ms: 4300,
      p95Ms: 8100,
    });
    const selectCalls = [...qb.select.mock.calls, ...qb.addSelect.mock.calls];
    expect(
      selectCalls.some(([sql]) => String(sql).includes('percentile_cont(0.5)')),
    ).toBe(true);
    expect(
      selectCalls.some(([sql]) =>
        String(sql).includes('percentile_cont(0.95)'),
      ),
    ).toBe(true);
  });

  it('is ungrouped — no bucket dimension, no date_trunc, no groupBy', async () => {
    const { repository, qb } = build({
      turns: '1',
      avgMs: '100',
      p50Ms: '100',
      p95Ms: '100',
    });

    await repository.getVoiceLatencyOverall(start, end);

    expect(qb.groupBy).not.toHaveBeenCalled();
    const selectCalls = [...qb.select.mock.calls, ...qb.addSelect.mock.calls];
    expect(
      selectCalls.some(([sql]) => String(sql).includes('date_trunc')),
    ).toBe(false);
  });

  it('scopes to source=pipeline only — the live-agent measurement the chart plots', async () => {
    const { repository, qb } = build({
      turns: '1',
      avgMs: '100',
      p50Ms: '100',
      p95Ms: '100',
    });

    await repository.getVoiceLatencyOverall(start, end);

    expect(qb.andWhere).toHaveBeenCalledWith(`m."source" = 'pipeline'`);
  });

  it('defaults turns to 0 and latencies to null with nothing in the window', async () => {
    const { repository } = build(undefined);

    const result = await repository.getVoiceLatencyOverall(start, end);

    expect(result).toEqual({
      turns: 0,
      avgMs: null,
      p50Ms: null,
      p95Ms: null,
    });
  });

  it('joins languages and filters by the resolved session language, only when asked', async () => {
    const { repository: unfiltered, qb: unfilteredQb } = build({
      turns: '1',
      avgMs: '1',
      p50Ms: '1',
      p95Ms: '1',
    });
    await unfiltered.getVoiceLatencyOverall(start, end);
    expect(unfilteredQb.innerJoin).not.toHaveBeenCalled();

    const { repository: filtered, qb: filteredQb } = build({
      turns: '1',
      avgMs: '1',
      p50Ms: '1',
      p95Ms: '1',
    });
    await filtered.getVoiceLatencyOverall(start, end, 'hi-IN');
    expect(filteredQb.innerJoin).toHaveBeenCalledWith(
      'scenario_sessions',
      's',
      's.id = m."scenarioSessionId"',
    );
    expect(filteredQb.andWhere).toHaveBeenCalledWith(
      `COALESCE(l.value, 'en') = :language`,
      { language: 'hi-IN' },
    );
  });
});
