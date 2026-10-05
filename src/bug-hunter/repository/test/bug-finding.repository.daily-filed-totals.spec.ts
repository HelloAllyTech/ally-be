import { DataSource } from 'typeorm';

import {
  BugFindingRepository,
  FINDING_DECLINED_STATUSES,
} from '../bug-finding.repository';

/**
 * `dailyFiledTotals` feeds the Bug Agent tab's "bugs found per day" trend.
 * What matters is pinned here: the window is applied in SQL as a half-open
 * range, child findings (re-discoveries) are excluded so nothing counts
 * twice, findings since dismissed or rejected are left out because they were
 * not bugs, and the count comes back as a number.
 */
describe('BugFindingRepository.dailyFiledTotals', () => {
  const build = () => {
    const query = jest.fn();
    const repo = new BugFindingRepository({
      createEntityManager: () => ({ query }),
    } as unknown as DataSource);
    return { repo, query };
  };

  it('counts top-level findings per UTC day inside the half-open window', async () => {
    const { repo, query } = build();
    query.mockResolvedValue([]);
    const start = new Date('2026-01-05T00:00:00.000Z');
    const end = new Date('2026-01-19T00:00:00.000Z');

    await repo.dailyFiledTotals(start, end);

    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([start, end, FINDING_DECLINED_STATUSES]);
    expect(sql).toContain(`date_trunc('day', f."createdAt")`);
    expect(sql).toContain('f.parent_finding_id IS NULL');
    expect(sql).toContain('f."createdAt" >= $1');
    expect(sql).toContain('f."createdAt" < $2');
  });

  it('leaves out findings that were dismissed or rejected, by their current status', async () => {
    const { repo, query } = build();
    query.mockResolvedValue([]);

    await repo.dailyFiledTotals(new Date(), new Date());

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('f.status <> ALL($3::text[])');
    expect(params[2]).toEqual(['dismissed', 'rejected']);
  });

  it('reads the count back as a number', async () => {
    const { repo, query } = build();
    const day = new Date('2026-01-06T00:00:00.000Z');
    query.mockResolvedValue([{ day, filed: '9' }]);

    await expect(repo.dailyFiledTotals(day, day)).resolves.toEqual([
      { day, filed: 9 },
    ]);
  });
});
