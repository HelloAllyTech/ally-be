import { DataSource } from 'typeorm';

import { FhsHumanRatingRepository } from '../repository/fhs-human-rating.repository';
import { parseQuarter } from '../util/human-rating.util';

const TEST_ORG = '"isTestOrganization" = true';

const build = (rows: unknown[] = []) => {
  const query = jest.fn().mockResolvedValue(rows);
  const repository = new FhsHumanRatingRepository({
    query,
  } as unknown as DataSource);
  return { query, repository };
};

const sqlOf = (query: jest.Mock) => ({
  sql: String(query.mock.calls[0][0]).replace(/\s+/g, ' '),
  params: query.mock.calls[0][1] as unknown[],
});

describe('FhsHumanRatingRepository', () => {
  it('getQuarterCandidates: scored under the pinned version, test orgs out, quarter bound as dates', async () => {
    const { query, repository } = build([
      {
        cut_id: 'c1',
        user_id: '12',
        closed_at: '2026-08-01T10:00:00.000Z',
        quarter: '2026Q3',
        composite: '2.75',
        session_ids: ['s1', 's2'],
        start_session_id: 's1',
        start_message_id: '100',
        end_session_id: 's2',
        end_message_id: '240',
        starts_mid_session: true,
        ends_mid_session: false,
        language: 'unknown',
      },
    ]);
    const rows = await repository.getQuarterCandidates(
      'fhs-text-v1',
      parseQuarter('2026Q3')!,
    );
    const { sql, params } = sqlOf(query);

    expect(params).toEqual(['fhs-text-v1', '2026-07-01', '2026-10-01']);
    expect(sql).toContain('a."rubricVersion" = $1');
    expect(sql).toContain("a.status = 'SCORED'");
    expect(sql).toContain('a."compositeScore" IS NOT NULL');
    expect(sql).toContain('c."closedSessionEndedAt" >= $2::timestamp');
    expect(sql).toContain('c."closedSessionEndedAt" < $3::timestamp');
    expect(sql).toContain(TEST_ORG);
    // Majority session language, never assumed English.
    expect(sql).toContain("NULLIF(ss.metadata->>'languageId', '')::int");
    expect(sql).toContain("'unknown'");
    expect(sql).not.toContain("'en'");
    // Ids and counts only — no message content is ever selected.
    expect(sql).not.toContain('content');

    expect(rows).toEqual([
      {
        cutId: 'c1',
        userId: 12,
        closedAt: new Date('2026-08-01T10:00:00.000Z'),
        compositeScore: 2.75,
        language: 'unknown',
        sessionIds: ['s1', 's2'],
        startSessionId: 's1',
        startMessageId: 100,
        endSessionId: 's2',
        endMessageId: 240,
        startsMidSession: true,
        endsMidSession: false,
      },
    ]);
  });

  it('getRatingCounts: one version, the caller bound, nothing queried for no cuts', async () => {
    const empty = build();
    expect((await empty.repository.getRatingCounts('v1', [], 7)).size).toBe(0);
    expect(empty.query).not.toHaveBeenCalled();

    const { query, repository } = build([
      { cut_id: 'c1', raters: 2, mine: true },
    ]);
    const counts = await repository.getRatingCounts('v1', ['c1', 'c2'], 7);
    const { sql, params } = sqlOf(query);
    expect(params).toEqual(['v1', ['c1', 'c2'], 7]);
    expect(sql).toContain('r."rubricVersion" = $1');
    expect(sql).toContain('r."cutId" = ANY($2::uuid[])');
    expect(sql).toContain('bool_or(r."raterId" = $3)');
    expect(counts.get('c1')).toEqual({ raters: 2, ratedByMe: true });
    expect(counts.get('c2')).toBeUndefined();
  });

  it('getCutForRating: whether the judge SCORED it under the version', async () => {
    const { query, repository } = build([
      { cut_id: 'c1', user_id: 3, judge_scored: false },
    ]);
    expect(await repository.getCutForRating('c1', 'v1')).toEqual({
      cutId: 'c1',
      userId: 3,
      judgeScored: false,
    });
    const { sql, params } = sqlOf(query);
    expect(params).toEqual(['c1', 'v1']);
    expect(sql).toContain('a."rubricVersion" = $2');
    expect(sql).toContain("a.status = 'SCORED'");

    expect(await build([]).repository.getCutForRating('c1', 'v1')).toBeNull();
  });

  it('upsertRating: one statement on the unique key, codes as jsonb, created from xmax', async () => {
    const { query, repository } = build([
      { id: 'r1', rated_at: '2026-10-05T12:00:00.000Z', created: false },
    ]);
    const ticks = [
      {
        skill: 'verbal',
        opportunity: true,
        level: 3 as const,
        observed: ['verbal.b1', 'verbal.b2'],
        notApplicable: [],
      },
    ];
    const out = await repository.upsertRating({
      cutId: 'c1',
      raterId: 7,
      rubricVersion: 'v1',
      ticks,
      anyUnhelpful: false,
    });
    const { sql, params } = sqlOf(query);
    expect(sql).toContain(
      'ON CONFLICT ("cutId", "raterId", "rubricVersion") DO UPDATE',
    );
    expect(sql).toContain('(xmax = 0) AS created');
    expect(params).toEqual(['c1', 7, 'v1', JSON.stringify(ticks), false]);
    expect(out).toEqual({
      id: 'r1',
      ratedAt: new Date('2026-10-05T12:00:00.000Z'),
      created: false,
    });
  });
});
