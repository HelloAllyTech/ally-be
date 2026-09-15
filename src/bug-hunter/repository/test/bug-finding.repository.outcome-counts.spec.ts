import { DataSource } from 'typeorm';

import { BugFindingRepository } from '../bug-finding.repository';

/**
 * Records the SQL fragments `outcomeCounts` builds.
 *
 * The rate this query feeds — `reversalRate = reversed / finderErrors`, where
 * `finderErrors` is derived from `count` — is only meaningful if BOTH counts
 * range over the same cohort. That invariant lives entirely in the SQL, where
 * the service-level specs (which hand-build rows) cannot see it, so it is
 * asserted here on the generated fragments.
 */
const recordingBuilder = () => {
  const selects: string[] = [];
  const wheres: string[] = [];
  const qb: Record<string, unknown> = {};
  const chain = (bucket?: string[]) =>
    jest.fn((sql: string) => {
      if (bucket) bucket.push(sql);
      return qb;
    });
  Object.assign(qb, {
    select: chain(selects),
    addSelect: chain(selects),
    where: chain(wheres),
    andWhere: chain(wheres),
    setParameter: chain(),
    groupBy: chain(),
    addGroupBy: chain(),
    getRawMany: jest.fn().mockResolvedValue([]),
  });
  return { qb, selects, wheres };
};

describe('BugFindingRepository.outcomeCounts', () => {
  const build = () => {
    const repo = new BugFindingRepository({
      createEntityManager: () => ({}),
    } as unknown as DataSource);
    const rec = recordingBuilder();
    (repo as unknown as { createQueryBuilder: unknown }).createQueryBuilder =
      jest.fn().mockReturnValue(rec.qb);
    return { repo, rec };
  };

  it('windows the reversed count on the same createdAt cohort as count', async () => {
    const { repo, rec } = build();

    await repo.outcomeCounts(new Date('2026-01-01T00:00:00Z'));

    const reversed = rec.selects.find((s) => s.includes('reversed_at'));
    expect(reversed).toBeDefined();
    // Same window as `count` — NOT `reversed_at >= :since`, which would make
    // the numerator a different cohort from the denominator and let the rate
    // exceed 100%.
    expect(reversed).toContain('f."createdAt" >= :since');
    expect(reversed).toContain('f.reversed_at IS NOT NULL');
    expect(reversed).not.toMatch(/reversed_at\s*>=/);
  });

  it('admits rows on createdAt alone, so no all-zero phantom groups appear', async () => {
    const { repo, rec } = build();

    await repo.outcomeCounts(new Date('2026-01-01T00:00:00Z'));

    expect(rec.wheres).toContain('f."createdAt" >= :since');
    expect(rec.wheres.some((w) => /\bOR\b/.test(w))).toBe(false);
  });
});
