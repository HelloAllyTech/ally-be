import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { StoredSkillVerdict } from '../entity/foundational-skill-assessment.entity';
import { humanRatingPopulationSql } from '../util/human-rating-population.util';
import type { CalendarQuarter } from '../util/human-rating.util';

/** A sampleable cut with what a rater needs to find its window. No text. */
export interface HumanRatingCandidateRow {
  cutId: string;
  userId: number;
  closedAt: Date;
  compositeScore: number;
  language: string;
  sessionIds: string[];
  startSessionId: string;
  startMessageId: number;
  endSessionId: string;
  endMessageId: number;
  startsMidSession: boolean;
  endsMidSession: boolean;
}

export interface CutRatingCount {
  raters: number;
  ratedByMe: boolean;
}

export interface CutForRating {
  cutId: string;
  userId: number;
  /** The judge has a SCORED assessment with a composite under the version. */
  judgeScored: boolean;
}

export interface UpsertedHumanRating {
  id: string;
  ratedAt: Date;
  created: boolean;
}

/**
 * Raw SQL for the human-rating programme (src/foundational-skills owns the
 * write side; the agreement chart reads the table from AnalyticsModule).
 */
@Injectable()
export class FhsHumanRatingRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** The quarter's sampleable cuts (see {@link humanRatingPopulationSql}). */
  async getQuarterCandidates(
    rubricVersion: string,
    quarter: CalendarQuarter,
  ): Promise<HumanRatingCandidateRow[]> {
    const rows = await this.dataSource.query(
      `${humanRatingPopulationSql({
        rubricParam: '$1',
        startParam: '$2',
        endParam: '$3',
      })}
       ORDER BY c.id`,
      [rubricVersion, quarter.startDate, quarter.endDate],
    );
    return rows.map(
      (r: any): HumanRatingCandidateRow => ({
        cutId: String(r.cut_id),
        userId: Number(r.user_id),
        closedAt: new Date(r.closed_at),
        compositeScore: Number(r.composite),
        language: String(r.language),
        sessionIds: Array.isArray(r.session_ids)
          ? r.session_ids.map(String)
          : [],
        startSessionId: String(r.start_session_id),
        startMessageId: Number(r.start_message_id),
        endSessionId: String(r.end_session_id),
        endMessageId: Number(r.end_message_id),
        startsMidSession: Boolean(r.starts_mid_session),
        endsMidSession: Boolean(r.ends_mid_session),
      }),
    );
  }

  /** Raters per cut under one version, and whether `raterId` is among them. */
  async getRatingCounts(
    rubricVersion: string,
    cutIds: readonly string[],
    raterId: number,
  ): Promise<Map<string, CutRatingCount>> {
    if (cutIds.length === 0) return new Map();
    const rows = await this.dataSource.query(
      `
      SELECT r."cutId"::text AS cut_id,
             COUNT(*)::int AS raters,
             bool_or(r."raterId" = $3) AS mine
        FROM fhs_human_ratings r
       WHERE r."rubricVersion" = $1
         AND r."cutId" = ANY($2::uuid[])
       GROUP BY r."cutId"
      `,
      [rubricVersion, cutIds, raterId],
    );
    return new Map(
      rows.map((r: any) => [
        String(r.cut_id),
        { raters: Number(r.raters), ratedByMe: Boolean(r.mine) },
      ]),
    );
  }

  /** The cut, and whether the judge scored it under `rubricVersion`. */
  async getCutForRating(
    cutId: string,
    rubricVersion: string,
  ): Promise<CutForRating | null> {
    const [row] = await this.dataSource.query(
      `
      SELECT c.id::text AS cut_id, c."userId" AS user_id,
             EXISTS (
               SELECT 1 FROM foundational_skill_assessments a
                WHERE a."cutId" = c.id
                  AND a."rubricVersion" = $2
                  AND a.status = 'SCORED'
                  AND a."compositeScore" IS NOT NULL
             ) AS judge_scored
        FROM foundational_skill_cuts c
       WHERE c.id = $1
      `,
      [cutId, rubricVersion],
    );
    if (!row) return null;
    return {
      cutId: String(row.cut_id),
      userId: Number(row.user_id),
      judgeScored: Boolean(row.judge_scored),
    };
  }

  /**
   * Insert, or replace the same rater's rating of the same cut under the same
   * version. One statement, so two submits racing each other leave one row.
   * `created` is Postgres's own answer (`xmax = 0` only on a fresh insert).
   */
  async upsertRating(input: {
    cutId: string;
    raterId: number;
    rubricVersion: string;
    ticks: StoredSkillVerdict[];
    anyUnhelpful: boolean;
  }): Promise<UpsertedHumanRating> {
    const [row] = await this.dataSource.query(
      `
      INSERT INTO fhs_human_ratings
        ("cutId", "raterId", "rubricVersion", "ticks", "anyUnhelpful", "ratedAt")
      VALUES ($1, $2, $3, $4::jsonb, $5, now())
      ON CONFLICT ("cutId", "raterId", "rubricVersion") DO UPDATE
         SET "ticks" = EXCLUDED."ticks",
             "anyUnhelpful" = EXCLUDED."anyUnhelpful",
             "ratedAt" = EXCLUDED."ratedAt",
             "updatedAt" = now()
      RETURNING id::text AS id, "ratedAt" AS rated_at, (xmax = 0) AS created
      `,
      [
        input.cutId,
        input.raterId,
        input.rubricVersion,
        JSON.stringify(input.ticks),
        input.anyUnhelpful,
      ],
    );
    return {
      id: String(row.id),
      ratedAt: new Date(row.rated_at),
      created: Boolean(row.created),
    };
  }
}
