import { DataSource } from 'typeorm';

import { JudgeAgreementAnalyticsRepository } from '../judge-agreement-analytics.repository';

/**
 * The judge-agreement reads: every one pins the rubric version as a bound
 * parameter, drops test organisations by the cut's own tenant, and compares a
 * human rating only with a SCORED judge assessment under the SAME version.
 */
const TEST_ORG = '"isTestOrganization" = true';

const build = (rows: unknown[] = []) => {
  const query = jest.fn().mockResolvedValue(rows);
  const repository = new JudgeAgreementAnalyticsRepository({
    query,
  } as unknown as DataSource);
  return { query, repository };
};

const sqlOf = (query: jest.Mock, call = 0) => ({
  sql: String(query.mock.calls[call][0]).replace(/\s+/g, ' '),
  params: query.mock.calls[call][1] as unknown[],
});

describe('JudgeAgreementAnalyticsRepository', () => {
  it('getRatings: pinned version on both sides, scored judge only, test orgs dropped', async () => {
    const { query, repository } = build([
      {
        cut_id: 'c1',
        rater_id: '7',
        human_verdicts: [{ skill: 'verbal' }],
        human_unhelpful: false,
        judge_verdicts: [{ skill: 'verbal' }],
        judge_unhelpful: null,
      },
    ]);
    const rows = await repository.getRatings('fhs-text-v1');
    const { sql, params } = sqlOf(query);

    expect(params).toEqual(['fhs-text-v1']);
    expect(sql).toContain('FROM fhs_human_ratings r');
    expect(sql).toContain('r."rubricVersion" = $1');
    expect(sql).toContain('a."rubricVersion" = $1');
    expect(sql).toContain("a.status = 'SCORED'");
    expect(sql).toContain('a."compositeScore" IS NOT NULL');
    expect(sql).toContain('(c."tenant_id")::text');
    expect(sql).toContain(TEST_ORG);
    expect(sql).not.toContain('fhs-text-v1');
    expect(rows).toEqual([
      {
        cutId: 'c1',
        raterId: 7,
        humanVerdicts: [{ skill: 'verbal' }],
        humanUnhelpful: false,
        judgeVerdicts: [{ skill: 'verbal' }],
        judgeUnhelpful: null,
      },
    ]);
  });

  it('getExclusions: counts other versions and missing judgements, test orgs dropped', async () => {
    const { query, repository } = build([
      { other_version: 4, no_judgement: 1 },
    ]);
    expect(await repository.getExclusions('fhs-text-v1')).toEqual({
      otherRubricVersion: 4,
      noJudgement: 1,
    });
    const { sql, params } = sqlOf(query);
    expect(params).toEqual(['fhs-text-v1']);
    expect(sql).toContain('r."rubricVersion" <> $1');
    expect(sql).toContain(
      'NOT EXISTS ( SELECT 1 FROM foundational_skill_assessments a',
    );
    expect(sql).toContain(TEST_ORG);
  });

  it('getPopulation: the sampling population, all quarters, pinned and test-org free', async () => {
    const { query, repository } = build([
      { cut_id: 'c1', quarter: '2026Q3', composite: '2.5', language: 'hi' },
    ]);
    expect(await repository.getPopulation('fhs-text-v1')).toEqual([
      { cutId: 'c1', quarter: '2026Q3', compositeScore: 2.5, language: 'hi' },
    ]);
    const { sql, params } = sqlOf(query);
    expect(params).toEqual(['fhs-text-v1']);
    expect(sql).toContain('a."rubricVersion" = $1');
    expect(sql).toContain("a.status = 'SCORED'");
    expect(sql).toContain(`to_char(c."closedSessionEndedAt", 'YYYY"Q"Q')`);
    expect(sql).toContain(TEST_ORG);
    // No quarter window here: every quarter is re-drawn.
    expect(sql).not.toContain('::timestamp');
  });
});
