import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { excludeTestTenants } from '../util/test-tenant.util';

export interface FoundationalSkillsCutRow {
  cut: number;
  learners: number;
  avgScore: number | null;
  baselineLearners: number;
  pairedAvgScore: number | null;
  baselineAvgScore: number | null;
  pairedChange: number | null;
  unhelpfulShare: number | null;
}

export interface FoundationalSkillsSkillRow {
  cut: number;
  skill: string;
  learners: number;
  avgScore: number;
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
  async getCutRows(rubricVersion: string): Promise<FoundationalSkillsCutRow[]> {
    const rows = await this.dataSource.query(
      `
      WITH scored AS (${this.scoredCte()}),
      base AS (SELECT user_id, score FROM scored WHERE cut = 1)
      SELECT s.cut,
             COUNT(*)::int AS learners,
             AVG(s.score) AS avg_score,
             COUNT(b.score)::int AS baseline_learners,
             AVG(s.score) FILTER (WHERE b.score IS NOT NULL) AS paired_avg,
             AVG(b.score) AS baseline_avg,
             AVG(s.score - b.score) AS paired_change,
             AVG(CASE WHEN s.unhelpful THEN 1.0 ELSE 0.0 END) AS unhelpful_share
        FROM scored s
        LEFT JOIN base b ON b.user_id = s.user_id
       GROUP BY s.cut
       ORDER BY s.cut
      `,
      [rubricVersion],
    );
    return rows.map((r: any) => ({
      cut: Number(r.cut),
      learners: Number(r.learners),
      avgScore: num(r.avg_score),
      baselineLearners: Number(r.baseline_learners),
      pairedAvgScore: num(r.paired_avg),
      baselineAvgScore: num(r.baseline_avg),
      pairedChange: num(r.paired_change),
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

  /** Scored cuts under `$1` with at least one assessable skill. */
  private scoredCte(): string {
    return `
      SELECT c."userId" AS user_id, c."cutIndex" AS cut,
             a."compositeScore"::float AS score,
             a."hasUnhelpfulBehaviour" AS unhelpful,
             a."skillLevels" AS levels
        FROM foundational_skill_cuts c
        JOIN foundational_skill_assessments a ON a."cutId" = c.id
       WHERE a."rubricVersion" = $1
         AND a.status = 'SCORED'
         AND a."compositeScore" IS NOT NULL
         AND ${excludeTestTenants('c."tenant_id"')}`;
  }
}
