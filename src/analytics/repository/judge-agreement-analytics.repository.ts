import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { StoredSkillVerdict } from 'src/foundational-skills/entity/foundational-skill-assessment.entity';
import { humanRatingPopulationSql } from 'src/foundational-skills/util/human-rating-population.util';
import { excludeTestTenants } from '../util/test-tenant.util';

/** One counted human rating beside the judge's verdict on the same cut. */
export interface JudgeAgreementRatingRow {
  cutId: string;
  raterId: number;
  humanVerdicts: StoredSkillVerdict[];
  humanUnhelpful: boolean;
  judgeVerdicts: StoredSkillVerdict[];
  judgeUnhelpful: boolean | null;
}

/** A sampleable cut, for re-drawing each quarter's sample. */
export interface JudgeAgreementPopulationRow {
  cutId: string;
  quarter: string;
  compositeScore: number;
  language: string;
}

export interface JudgeAgreementExclusions {
  otherRubricVersion: number;
  noJudgement: number;
}

/** The judge's SCORED assessment of `c` under the version bound to `$1`. */
const JUDGE_SCORED = `
          a."cutId" = c.id
          AND a."rubricVersion" = $1
          AND a.status = 'SCORED'
          AND a."compositeScore" IS NOT NULL`;

/**
 * Reads `fhs_human_ratings` against `foundational_skill_assessments` for the
 * judge-agreement chart. Every query is pinned to ONE rubric version — a human
 * rating counts only beside a judge score made under the same ruler — and drops
 * test organisations by the cut's own tenant, like every FHS read.
 * Platform-wide by design (no tenant scoping): agreement is a property of the
 * instrument, and a 30-a-quarter sample split by org would be empty.
 */
@Injectable()
export class JudgeAgreementAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Every counted rating, with the judge's verdicts on the same cut. */
  async getRatings(rubricVersion: string): Promise<JudgeAgreementRatingRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT r."cutId"::text AS cut_id,
             r."raterId" AS rater_id,
             r.ticks AS human_verdicts,
             r."anyUnhelpful" AS human_unhelpful,
             a.verdicts AS judge_verdicts,
             a."hasUnhelpfulBehaviour" AS judge_unhelpful
        FROM fhs_human_ratings r
        JOIN foundational_skill_cuts c ON c.id = r."cutId"
        JOIN foundational_skill_assessments a ON ${JUDGE_SCORED}
       WHERE r."rubricVersion" = $1
         AND ${excludeTestTenants('c."tenant_id"')}
       ORDER BY r."cutId", r."raterId"
      `,
      [rubricVersion],
    );
    return rows.map(
      (r: any): JudgeAgreementRatingRow => ({
        cutId: String(r.cut_id),
        raterId: Number(r.rater_id),
        humanVerdicts: Array.isArray(r.human_verdicts) ? r.human_verdicts : [],
        humanUnhelpful: Boolean(r.human_unhelpful),
        judgeVerdicts: Array.isArray(r.judge_verdicts) ? r.judge_verdicts : [],
        judgeUnhelpful:
          r.judge_unhelpful === null || r.judge_unhelpful === undefined
            ? null
            : Boolean(r.judge_unhelpful),
      }),
    );
  }

  /** Ratings left out, by reason, so a thin chart can say why. */
  async getExclusions(
    rubricVersion: string,
  ): Promise<JudgeAgreementExclusions> {
    const [row] = await this.dataSource.query(
      `
      SELECT COUNT(*) FILTER (WHERE r."rubricVersion" <> $1)::int AS other_version,
             COUNT(*) FILTER (
               WHERE r."rubricVersion" = $1
                 AND NOT EXISTS (
                   SELECT 1 FROM foundational_skill_assessments a
                    WHERE ${JUDGE_SCORED}
                 )
             )::int AS no_judgement
        FROM fhs_human_ratings r
        JOIN foundational_skill_cuts c ON c.id = r."cutId"
       WHERE ${excludeTestTenants('c."tenant_id"')}
      `,
      [rubricVersion],
    );
    return {
      otherRubricVersion: Number(row?.other_version ?? 0),
      noJudgement: Number(row?.no_judgement ?? 0),
    };
  }

  /**
   * Every sampleable cut, all quarters — the same population the sampling API
   * draws from (`humanRatingPopulationSql`), so coverage re-draws exactly the
   * samples raters were given.
   */
  async getPopulation(
    rubricVersion: string,
  ): Promise<JudgeAgreementPopulationRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT p.cut_id, p.quarter, p.composite, p.language
        FROM (${humanRatingPopulationSql({ rubricParam: '$1' })}) p
       ORDER BY p.quarter, p.cut_id
      `,
      [rubricVersion],
    );
    return rows.map(
      (r: any): JudgeAgreementPopulationRow => ({
        cutId: String(r.cut_id),
        quarter: String(r.quarter),
        compositeScore: Number(r.composite),
        language: String(r.language),
      }),
    );
  }
}
