import { DataSource } from 'typeorm';

import { HighlightsAnalyticsRepository } from '../highlights-analytics.repository';

/**
 * `getPracticeMinutesOverall` is the whole-window KPI counterpart to
 * `getPracticeMinutesByBucket` — it must be a genuinely separate, ungrouped
 * query (no `groupBy`), not a fold of the bucketed rows, because
 * `activeLearners` is a `COUNT(DISTINCT userId)` that would double-count a
 * learner active in more than one bucket if it were summed instead.
 */
describe('HighlightsAnalyticsRepository.getPracticeMinutesOverall', () => {
  const build = (rawRow: Record<string, unknown> | undefined) => {
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue(rawRow),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    const dataSource = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as DataSource;
    const repository = new HighlightsAnalyticsRepository(dataSource);
    return { repository, qb };
  };

  const start = new Date('2026-08-01T00:00:00.000Z');
  const end = new Date('2026-09-01T00:00:00.000Z');

  it('sums minutes and counts distinct learners over the whole window', async () => {
    const { repository, qb } = build({ minutes: '150', activeLearners: '6' });

    const result = await repository.getPracticeMinutesOverall(start, end);

    expect(result).toEqual({ minutes: 150, activeLearners: 6 });
    expect(qb.from).toHaveBeenCalledWith('user_daily_scores', 'd');
    expect(qb.where).toHaveBeenCalledWith('d."date" >= :start', { start });
    expect(qb.andWhere).toHaveBeenCalledWith('d."date" < :end', { end });
  });

  it('is an ungrouped, un-bucketed query — never groups or truncates by bucket', async () => {
    const { repository, qb } = build({ minutes: '10', activeLearners: '1' });

    await repository.getPracticeMinutesOverall(start, end);

    expect(qb.groupBy).not.toHaveBeenCalled();
    // The whole point of a separate "overall" method: no per-bucket dimension
    // in the select list at all.
    const selectCalls = [...qb.select.mock.calls, ...qb.addSelect.mock.calls];
    expect(
      selectCalls.some(([sql]) => String(sql).includes('date_trunc')),
    ).toBe(false);
  });

  it('counts learners with COUNT(DISTINCT ...), not a plain COUNT', async () => {
    const { repository, qb } = build({ minutes: '10', activeLearners: '1' });

    await repository.getPracticeMinutesOverall(start, end);

    const selectCalls = [...qb.select.mock.calls, ...qb.addSelect.mock.calls];
    expect(
      selectCalls.some(([sql]) =>
        String(sql).includes('COUNT(DISTINCT d."userId")'),
      ),
    ).toBe(true);
  });

  it('defaults to zero, not null, with no rows in the window', async () => {
    const { repository } = build(undefined);

    const result = await repository.getPracticeMinutesOverall(start, end);

    expect(result).toEqual({ minutes: 0, activeLearners: 0 });
  });

  it('scopes to a tenant only when one is given', async () => {
    const { repository: unscoped, qb: unscopedQb } = build({
      minutes: '10',
      activeLearners: '1',
    });
    await unscoped.getPracticeMinutesOverall(start, end);
    expect(unscopedQb.andWhere).toHaveBeenCalledTimes(2); // window + exclude-test-tenants

    const { repository: scoped, qb: scopedQb } = build({
      minutes: '10',
      activeLearners: '1',
    });
    await scoped.getPracticeMinutesOverall(start, end, 'acme');
    expect(scopedQb.andWhere).toHaveBeenCalledTimes(3); // + tenant scope
  });
});
