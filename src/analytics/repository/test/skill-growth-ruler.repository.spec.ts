import { DataSource } from 'typeorm';

import { FHS_RUBRIC_VERSION } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import { CompetencyMapAnalyticsRepository } from '../competency-map-analytics.repository';
import { FoundationalSkillsAnalyticsRepository } from '../foundational-skills-analytics.repository';
import { SkillGrowthAnalyticsRepository } from '../skill-growth-analytics.repository';
import { CompetencyMapAnalyticsService } from '../../service/competency-map-analytics.service';
import { SkillGrowthAnalyticsService } from '../../service/skill-growth-analytics.service';

/**
 * The Phase 0 ruler fix, proven at the SQL the endpoints actually send.
 *
 * Skill growth (AAQ-042..047, 049) and the competency map (AAQ-048) used to
 * read `scenario_session_details."compositeScore"` — the LLM judge's score of
 * the AI ACTOR — as a learner score. These specs run the real services over
 * the real repositories with only `DataSource.query` faked, and assert on
 * every statement: none touches the actor composite, and the learner ruler is
 * read pinned to the rubric version, with test organisations excluded and the
 * org filter bound as a parameter on the cut's own tenant.
 */
const TENANT = 'b3f1c2d4-0000-4000-8000-000000000001';

/** Raw rows as Postgres returns them for `getAllLearnerCuts`. */
const rawCuts = [1, 2, 3, 4].map((cut) => ({
  user_id: 7,
  name: 'Asha',
  tenant_id: TENANT,
  cut,
  closed_at: new Date(Date.UTC(2026, 7, cut)),
  score: String(2 + cut / 4),
  unhelpful: false,
  levels: { empathy: 2 + (cut % 2) },
  verdicts: [{ skill: 'empathy', observed: ['empathy.b1'] }],
  session_ids: [`0000000${cut}-0000-4000-8000-000000000000`],
}));

const build = () => {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('FROM foundational_skill_cuts')) return rawCuts;
    if (sql.includes('FROM scenario_sessions ss')) {
      return rawCuts.map((c) => ({
        session_id: c.session_ids[0],
        scenario_id: 1,
        title: 'Grief',
      }));
    }
    if (sql.includes('FROM users u')) {
      return [
        { id: 7, name: 'Asha', email: 'asha@example.com', tenantId: TENANT },
      ];
    }
    if (sql.includes('CROSS JOIN LATERAL')) {
      return [{ scenarioId: 1, competencyId: 'c-empathy' }];
    }
    if (sql.includes('"unattributedSessions"')) {
      return [{ completedSessions: 9, unattributedSessions: 1 }];
    }
    if (sql.includes('FROM expanded x')) {
      return [
        {
          competencyId: 'c-empathy',
          name: 'Empathy, Warmth & Genuineness',
          completedSessions: 8,
          learners: 1,
          scenarios: 1,
        },
      ];
    }
    return [];
  });
  const dataSource = { query } as unknown as DataSource;
  const fhs = new FoundationalSkillsAnalyticsRepository(dataSource);
  return {
    query,
    skillGrowth: new SkillGrowthAnalyticsService(
      new SkillGrowthAnalyticsRepository(dataSource),
      fhs,
    ),
    competencyMap: new CompetencyMapAnalyticsService(
      new CompetencyMapAnalyticsRepository(dataSource),
      fhs,
    ),
  };
};

const callsOf = (query: jest.Mock) =>
  query.mock.calls.map(([sql, params]) => ({
    sql: String(sql),
    params: (params ?? []) as unknown[],
  }));

/** Every endpoint behind the sub-tab, platform-wide and narrowed to one org. */
const runAll = async (tenantId?: string) => {
  const { query, skillGrowth, competencyMap } = build();
  await skillGrowth.getSkillGrowth({ tenantId });
  await skillGrowth.getLearnerTrends({ tenantId });
  await skillGrowth.getLearnerSeries(7);
  await competencyMap.getCompetencyMap({ tenantId });
  return callsOf(query);
};

describe('Skill growth + competency map — the learner ruler, at the SQL', () => {
  it.each([undefined, TENANT])(
    'never reads the AI actor composite (tenant %s)',
    async (tenantId) => {
      const calls = await runAll(tenantId);
      expect(calls.length).toBeGreaterThan(0);
      for (const { sql } of calls) {
        expect(sql).not.toContain('scenario_session_details');
        expect(sql).not.toMatch(/\bd\."compositeScore"/);
        expect(sql).not.toContain('evaluationStatus');
      }
    },
  );

  it('reads scored cuts pinned to the rubric, SCORED, composite present, test orgs out', async () => {
    const cutReads = (await runAll()).filter(({ sql }) =>
      sql.includes('FROM foundational_skill_cuts'),
    );
    // getSkillGrowth, getLearnerTrends, getLearnerSeries, getCompetencyMap.
    expect(cutReads).toHaveLength(4);
    for (const { sql, params } of cutReads) {
      expect(params).toEqual([FHS_RUBRIC_VERSION]);
      expect(sql).toContain('a."rubricVersion" = $1');
      expect(sql).toContain("a.status = 'SCORED'");
      expect(sql).toContain('a."compositeScore" IS NOT NULL');
      expect(sql).toContain('(c."tenant_id")::text');
      expect(sql).toContain('"isTestOrganization" = true');
    }
  });

  it('narrows the cuts by their own tenant, bound as $2, never interpolated', async () => {
    const calls = await runAll(TENANT);
    const cutReads = calls.filter(({ sql }) =>
      sql.includes('FROM foundational_skill_cuts'),
    );
    // The drill-down stays platform-wide; the other three are scoped.
    const scoped = cutReads.filter(({ params }) => params.length === 2);
    expect(scoped).toHaveLength(3);
    for (const { sql, params } of scoped) {
      expect(params).toEqual([FHS_RUBRIC_VERSION, TENANT]);
      expect(sql).toContain('st.id::text = $2 OR st.code = $2');
      expect(sql).toContain('"isTestOrganization" = true');
    }
    for (const { sql } of calls) {
      expect(sql).not.toContain(TENANT);
    }
  });

  it('keeps the competency volume axis on countable, non-test, org-scoped sessions', async () => {
    const volume = (await runAll(TENANT)).filter(({ sql }) =>
      sql.includes('expanded AS'),
    );
    expect(volume).toHaveLength(2);
    for (const { sql, params } of volume) {
      expect(params).toEqual(['COMPLETED', TENANT]);
      expect(sql).toContain('(s."tenant_id")::text');
      expect(sql).toContain('st.id::text = $2 OR st.code = $2');
      expect(sql).toContain('"isTestOrganization" = true');
      expect(sql).toContain("NOT LIKE 'preview-%'");
    }
  });

  it('looks scenario tags up by bound id with the same v1/v2 expansion', async () => {
    const [tags] = (await runAll()).filter(({ sql }) =>
      sql.includes('CROSS JOIN LATERAL'),
    );
    expect(tags.params).toEqual([[1]]);
    expect(tags.sql).toContain('sc.id = ANY($1::int[])');
    expect(tags.sql).toContain('jsonb_array_elements_text');
    expect(tags.sql).toContain('sc."deletedAt" IS NULL');
  });

  it('produces learner-ruler numbers end to end', async () => {
    const { skillGrowth, competencyMap } = build();

    const growth = await skillGrowth.getSkillGrowth({});
    expect(growth.ordinals[0].all.n).toBe(1);
    expect(growth.summary.evaluatedSessions).toBe(4);
    expect(growth.scoreDomain).toEqual([1, 4]);

    const series = await skillGrowth.getLearnerSeries(7);
    expect(series.sessions.map((s) => s.compositeScore)).toEqual([
      2.25, 2.5, 2.75, 3,
    ]);
    expect(series.sessions[0].scenarioTitle).toBe('Grief');

    const map = await competencyMap.getCompetencyMap({});
    expect(map.competencies[0]).toMatchObject({
      skill: 'empathy',
      taggedCuts: 4,
      scoredCuts: 4,
      // Four cuts is below the floor of 20: counted, not scored.
      score: null,
      scoreUnavailable: 'tooFewCuts',
    });
  });
});
