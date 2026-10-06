import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  ScenarioSessionEventStatus,
  ScenarioSessionStatus,
} from 'src/learn/enum/scenario-session-status.enum';
import { StoredVerdictLite } from '../util/foundational-skills-progress.util';
import {
  countableSessionPredicate,
  sessionDurationMsExpr,
} from '../util/session-eligibility.util';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';

export interface FoundationalSkillsCutRow {
  cut: number;
  learners: number;
  avgScore: number | null;
  baselineLearners: number;
  pairedAvgScore: number | null;
  baselineAvgScore: number | null;
  pairedChange: number | null;
  /** Sample SD of the paired learners' own changes (for the change's CI). */
  pairedChangeSd: number | null;
  unhelpfulShare: number | null;
}

export interface FoundationalSkillsSkillRow {
  cut: number;
  skill: string;
  learners: number;
  avgScore: number;
}

/** One scored cut of one learner, for the per-learner drill-down. */
export interface FoundationalSkillsLearnerCutRow {
  userId: number;
  name: string | null;
  tenantId: string | null;
  cut: number;
  closedAt: Date;
  score: number;
  unhelpful: boolean | null;
  levels: Record<string, number>;
  verdicts: StoredVerdictLite[];
  /** Every session the cut touches, in consumption order. */
  sessionIds: string[];
}

export interface FoundationalSkillsCoverageRow {
  learners: number;
  cutsSealed: number;
  cutsScored: number;
  cutsFailed: number;
  cutsPending: number;
}

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

const toLearnerCutRow = (r: any): FoundationalSkillsLearnerCutRow => ({
  userId: Number(r.user_id),
  name: (r.name as string | null) ?? null,
  tenantId: (r.tenant_id as string | null) ?? null,
  cut: Number(r.cut),
  closedAt: new Date(r.closed_at),
  score: Number(r.score),
  unhelpful: r.unhelpful ?? null,
  levels: r.levels ?? {},
  verdicts: Array.isArray(r.verdicts) ? r.verdicts : [],
  sessionIds: Array.isArray(r.session_ids) ? r.session_ids.map(String) : [],
});

/**
 * Reads the foundational-skills measure (src/foundational-skills) for the
 * Priority tab. Every query is pinned to one rubric version: scores from two
 * rulers are never averaged together.
 *
 * Test organisations are dropped here as well as at cutting time, so a tenant
 * flagged as a test org after its cuts were sealed disappears from the chart
 * without anything being deleted.
 */
@Injectable()
export class FoundationalSkillsAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * One row per cut index.
   *
   * `paired*`, `baseline*` and `pairedChange` compare each learner at cut k with
   * THEMSELVES at cut 1, over the learners who reached cut k AND have a scored
   * cut 1 (a failed or unassessable first cut drops a learner from the pair):
   * `pairedAvgScore` is their cut-k average, `baselineAvgScore` their cut-1
   * average, and `pairedChange` the mean of their own differences — so
   * paired − baseline = change exactly. `avgScore`/`learners` cover everyone
   * at cut k. That is
   * what separates "people improved" from "the people who kept practising were
   * better to begin with", which the raw per-cut average cannot.
   */
  async getCutRows(
    rubricVersion: string,
    baselineCut = 1,
  ): Promise<FoundationalSkillsCutRow[]> {
    const rows = await this.dataSource.query(
      `
      WITH scored AS (${this.scoredCte()}),
      base AS (SELECT user_id, score FROM scored WHERE cut = $2)
      SELECT s.cut,
             COUNT(*)::int AS learners,
             AVG(s.score) AS avg_score,
             COUNT(b.score)::int AS baseline_learners,
             AVG(s.score) FILTER (WHERE b.score IS NOT NULL) AS paired_avg,
             AVG(b.score) AS baseline_avg,
             AVG(s.score - b.score) AS paired_change,
             STDDEV_SAMP(s.score - b.score) AS paired_change_sd,
             AVG(CASE WHEN s.unhelpful THEN 1.0 ELSE 0.0 END) AS unhelpful_share
        FROM scored s
        LEFT JOIN base b ON b.user_id = s.user_id
       GROUP BY s.cut
       ORDER BY s.cut
      `,
      [rubricVersion, baselineCut],
    );
    return rows.map((r: any) => ({
      cut: Number(r.cut),
      learners: Number(r.learners),
      avgScore: num(r.avg_score),
      baselineLearners: Number(r.baseline_learners),
      pairedAvgScore: num(r.paired_avg),
      baselineAvgScore: num(r.baseline_avg),
      pairedChange: num(r.paired_change),
      pairedChangeSd: num(r.paired_change_sd),
      unhelpfulShare: num(r.unhelpful_share),
    }));
  }

  /** Per-skill averages by cut, over the learners the skill was assessable for. */
  async getSkillRows(
    rubricVersion: string,
  ): Promise<FoundationalSkillsSkillRow[]> {
    const rows = await this.dataSource.query(
      `
      WITH scored AS (${this.scoredCte()})
      SELECT s.cut, kv.key AS skill, COUNT(*)::int AS learners,
             AVG(kv.value::numeric) AS avg_score
        FROM scored s
        CROSS JOIN LATERAL jsonb_each_text(s.levels) kv
       GROUP BY s.cut, kv.key
       ORDER BY s.cut, kv.key
      `,
      [rubricVersion],
    );
    return rows.map((r: any) => ({
      cut: Number(r.cut),
      skill: String(r.skill),
      learners: Number(r.learners),
      avgScore: Number(r.avg_score),
    }));
  }

  /**
   * Every scored cut of the learners who have a scored cut at `minCut` — the
   * same membership rule the chart's `learners` count uses, so `minCut = 5`
   * returns exactly the people behind the cut-5 point. Paged by user id, so a
   * page boundary never splits one learner's cuts. `userId` narrows to one
   * learner (the Skills tab's per-person panel).
   */
  async getLearnerCuts(
    rubricVersion: string,
    opts: { minCut: number; limit: number; offset: number; userId?: number },
  ): Promise<{ total: number; rows: FoundationalSkillsLearnerCutRow[] }> {
    const userFilter = opts.userId !== undefined ? 'AND user_id = $3' : '';
    const userParams = opts.userId !== undefined ? [opts.userId] : [];
    const n = userParams.length;
    const [rows, [count]] = await Promise.all([
      this.dataSource.query(
        `
        WITH scored AS (${this.scoredCte()}),
        page AS (
          SELECT DISTINCT user_id FROM scored WHERE cut = $2 ${userFilter}
           ORDER BY user_id LIMIT $${3 + n} OFFSET $${4 + n}
        )
        ${this.learnerCutSelect('JOIN page p ON p.user_id = s.user_id')}
        `,
        [rubricVersion, opts.minCut, ...userParams, opts.limit, opts.offset],
      ),
      this.dataSource.query(
        `
        WITH scored AS (${this.scoredCte()})
        SELECT COUNT(DISTINCT user_id)::int AS total
          FROM scored WHERE cut = $2 ${userFilter}
        `,
        [rubricVersion, opts.minCut, ...userParams],
      ),
    ]);
    return {
      total: Number(count?.total ?? 0),
      rows: rows.map(toLearnerCutRow),
    };
  }

  /**
   * Every scored cut of every learner, for the Skills sub-tab's in-memory
   * analysis. Fine at today's volume (hundreds of cuts); revisit — a summary
   * table or SQL-side aggregation — before it reaches the tens of thousands.
   *
   * `tenantId` narrows to the cuts practised in one org (the Helping skills
   * tab's org filter). A learner who moved orgs keeps their absolute cut
   * numbers, so their cuts from the new org start past cut 1 and they drop out
   * of any panel that needs cuts 1..N — practice done elsewhere is not
   * credited to this org.
   */
  async getAllLearnerCuts(
    rubricVersion: string,
    tenantId?: string,
  ): Promise<FoundationalSkillsLearnerCutRow[]> {
    const rows = await this.dataSource.query(
      `
      WITH scored AS (${this.scoredCte(tenantId ? '$2' : undefined)})
      ${this.learnerCutSelect('')}
      `,
      tenantId ? [rubricVersion, tenantId] : [rubricVersion],
    );
    return rows.map(toLearnerCutRow);
  }

  /**
   * Practice minutes behind each learner's scored cuts (the dose–response
   * scatter, AAQ-217): the summed duration, net of pauses
   * (`sessionDurationMsExpr`), of every DISTINCT countable session that appears
   * in at least one of the learner's scored cuts under `rubricVersion` — the
   * same cuts, in the same org scope, that their own change is measured on. A
   * session split across two cuts counts once, whole. Sessions in a cut that
   * failed scoring, and practice not yet sealed into a cut, are not counted:
   * x and y describe the same practice.
   *
   * `userIds` narrows to the learners the caller will plot. A learner with no
   * measurable duration is ABSENT from the map (unknown), never 0.
   */
  async getPracticeMinutesByLearner(
    rubricVersion: string,
    userIds: readonly number[],
    tenantId?: string,
  ): Promise<Map<number, number>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.dataSource.query(
      `
      WITH scored AS (${this.scoredCte(tenantId ? '$3' : undefined)}),
      sessions AS (
        SELECT DISTINCT sc.user_id, x.session_id
          FROM scored sc
          CROSS JOIN LATERAL unnest(sc.session_ids) AS x(session_id)
         WHERE sc.user_id = ANY($2::int[])
      )
      SELECT se.user_id,
             SUM(${sessionDurationMsExpr('s', 'd')})::float AS ms
        FROM sessions se
        JOIN scenario_sessions s ON s.id = se.session_id
        LEFT JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
       WHERE s.status = '${ScenarioSessionStatus.ENDED}'
         AND s."eventStatus" = '${ScenarioSessionEventStatus.COMPLETED}'
         AND ${countableSessionPredicate('s')}
       GROUP BY se.user_id
      `,
      tenantId
        ? [rubricVersion, [...userIds], tenantId]
        : [rubricVersion, [...userIds]],
    );
    const out = new Map<number, number>();
    for (const r of rows) {
      if (r.ms === null || r.ms === undefined) continue;
      out.set(Number(r.user_id), Number(r.ms) / 60000);
    }
    return out;
  }

  private learnerCutSelect(join: string): string {
    return `
      SELECT s.user_id, u.name, s.tenant_id, s.cut, s.closed_at,
             s.score, s.unhelpful, s.levels, s.verdicts, s.session_ids
        FROM scored s
        ${join}
        LEFT JOIN users u ON u.id = s.user_id
       ORDER BY s.user_id, s.cut`;
  }

  /**
   * Scenario behind each session, for the learner drill-down: which scenarios
   * filled a cut is the context every per-cut score needs (a cut of one
   * scenario's content is not comparable with a cut of another's).
   */
  async getSessionScenarios(
    sessionIds: string[],
  ): Promise<
    Map<string, { scenarioId: number | null; scenarioTitle: string | null }>
  > {
    if (sessionIds.length === 0) return new Map();
    const rows = await this.dataSource.query(
      `
      SELECT ss.id::text AS session_id, ss."scenarioId" AS scenario_id, sc.title AS title
        FROM scenario_sessions ss
        LEFT JOIN scenarios sc ON sc.id = ss."scenarioId"
       WHERE ss.id = ANY($1::uuid[])
      `,
      [sessionIds],
    );
    return new Map(
      rows.map((r: any) => [
        String(r.session_id),
        {
          scenarioId: r.scenario_id === null ? null : Number(r.scenario_id),
          scenarioTitle: (r.title as string | null) ?? null,
        },
      ]),
    );
  }

  /** How far scoring has got under this version, so a thin chart can say why. */
  async getCoverage(
    rubricVersion: string,
  ): Promise<FoundationalSkillsCoverageRow> {
    const [row] = await this.dataSource.query(
      `
      SELECT COUNT(DISTINCT c."userId")::int AS learners,
             COUNT(*)::int AS cuts_sealed,
             COUNT(*) FILTER (WHERE a.status = 'SCORED')::int AS cuts_scored,
             COUNT(*) FILTER (WHERE a.status = 'FAILED')::int AS cuts_failed,
             COUNT(*) FILTER (WHERE a.id IS NULL)::int AS cuts_pending
        FROM foundational_skill_cuts c
        LEFT JOIN foundational_skill_assessments a
          ON a."cutId" = c.id AND a."rubricVersion" = $1
       WHERE ${excludeTestTenants('c."tenant_id"')}
      `,
      [rubricVersion],
    );
    return {
      learners: Number(row?.learners ?? 0),
      cutsSealed: Number(row?.cuts_sealed ?? 0),
      cutsScored: Number(row?.cuts_scored ?? 0),
      cutsFailed: Number(row?.cuts_failed ?? 0),
      cutsPending: Number(row?.cuts_pending ?? 0),
    };
  }

  /**
   * Scored cuts under `$1` with at least one assessable skill. `tenantParam` is
   * the placeholder the caller bound a tenant id to, when it narrows to one org;
   * the id itself always travels as a bound parameter.
   */
  private scoredCte(tenantParam?: string): string {
    const tenantPredicate = tenantParam
      ? `\n         AND ${scopeToTenant('c."tenant_id"', tenantParam)}`
      : '';
    return `
      SELECT c."userId" AS user_id, c."cutIndex" AS cut,
             a."compositeScore"::float AS score,
             a."hasUnhelpfulBehaviour" AS unhelpful,
             a."skillLevels" AS levels,
             a.verdicts AS verdicts,
             c."tenant_id" AS tenant_id,
             c."closedSessionEndedAt" AS closed_at,
             c."sessionIds" AS session_ids
        FROM foundational_skill_cuts c
        JOIN foundational_skill_assessments a ON a."cutId" = c.id
       WHERE a."rubricVersion" = $1
         AND a.status = 'SCORED'
         AND a."compositeScore" IS NOT NULL
         AND ${excludeTestTenants('c."tenant_id"')}${tenantPredicate}`;
  }
}
