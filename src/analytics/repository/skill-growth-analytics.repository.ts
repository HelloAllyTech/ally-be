import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import { ActorEvaluationStatus } from '../../learn/service/scenario-session-evaluation.service';
import { countableSessionPredicate } from '../util/session-eligibility.util';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';

/**
 * How far along a learner's practice history the curve is drawn.
 *
 * Twelve because that is where the sample runs out, not because it is a round
 * number: the population halves every few ordinals, so beyond about a dozen
 * sessions every cell is a handful of enthusiasts and the "curve" is their
 * personal noise plotted as a platform trend. The endpoint returns the full axis
 * to this bound with the counts attached, so where the line stops being credible
 * is visible on the card rather than hidden in a query.
 */
export const SKILL_GROWTH_MAX_ORDINAL = 12;

/**
 * Evaluated sessions a learner needs before their whole history counts as the
 * "experienced" variant.
 *
 * The flagship chart has a survivorship problem it cannot solve, only declare.
 * Ordinal 1 is every learner who ever practised; ordinal 8 is only the learners
 * who kept going — and the ones who kept going are disproportionately the ones
 * who were doing well. So a rising line over ALL learners is partly real
 * improvement and partly the weak leavers dropping out of the denominator.
 *
 * The "experienced" variant answers that by holding the population fixed: only
 * learners with at least this many evaluated sessions, measured from THEIR first
 * session onwards. If both lines rise, the improvement survives the composition
 * change. If only the "all" line rises, what is being measured is attrition.
 *
 * Six is the smallest cohort length that still leaves a visible slope to compare
 * (a three-session floor barely moves) while keeping enough learners in the
 * population to clear `MIN_SCORE_SAMPLE_SIZE` (see
 * `quality-distribution-analytics.repository.ts`) at its later ordinals.
 */
export const SKILL_GROWTH_EXPERIENCED_MIN_SESSIONS = 6;

/**
 * How the score being plotted was produced, echoed to the client.
 *
 * A learning curve is only a learning curve if the ruler stayed the same length.
 * These strings are on the card because the score is an LLM judge's composite of
 * per-goal rubric scores, and a judge model or rubric change moves every point on
 * the line without any learner doing anything differently. This endpoint does NOT
 * pin a judge version yet, so the note says so rather than letting the chart
 * imply a controlled comparison.
 */
export const SKILL_GROWTH_DERIVATION =
  'LLM judge (composite of per-goal rubric scores) over completed sessions, ' +
  'ordered per learner by session start';

export const SKILL_GROWTH_PROVENANCE_NOTE =
  'Scores are only comparable within one judge model + rubric version: a change ' +
  'to either moves the whole curve without any learner practising differently. ' +
  'This endpoint does NOT pin a judge version yet, so a step in the line may be ' +
  'a change in the ruler rather than in the learners.';

/** One percentile cell — raw, unsuppressed. The service applies the floor. */
export interface SkillGrowthCell {
  median: number | null;
  p25: number | null;
  p75: number | null;
  /** Sessions behind the cell. Travels even when the percentiles are dropped. */
  n: number;
}

/** One ordinal of the curve, both variants. */
export interface SkillGrowthOrdinalRow {
  /** 1 = the learner's first evaluated session. */
  ordinal: number;
  /** Every learner who reached this ordinal. */
  all: SkillGrowthCell;
  /** Same rows, restricted to learners with >= the experience threshold. */
  experienced: SkillGrowthCell;
}

/** The curve plus the population totals it was drawn from. */
export interface SkillGrowthDistribution {
  ordinals: SkillGrowthOrdinalRow[];
  /** Learners with >= 1 evaluated session. */
  learners: number;
  /** Of those, learners at or above the experience threshold. */
  experiencedLearners: number;
  /** Evaluated sessions across every learner — including beyond the max ordinal. */
  evaluatedSessions: number;
}

/**
 * Does a learner's Nth simulation score better than their first?
 *
 * The efficacy question the platform exists to answer, and the one no calendar
 * chart can: the quality trend on the Highlights tab moves when the MIX of
 * learners changes, so a month of new signups drags it down while every
 * individual improves. Re-indexing each learner's sessions to their OWN first
 * one removes the calendar entirely — ordinal 3 means "the third simulation this
 * person ever had judged", whenever that happened.
 *
 * ALL-TIME by construction, like roleplay volume and cohort retention: this
 * endpoint takes no `range`/`bucket`/`from`/`to`. A learning curve over a 30-day
 * window is a window artefact — almost every learner has one or two evaluated
 * sessions inside it, so the later ordinals would be built from whoever happened
 * to binge that month, and the chart would report the length of the window.
 *
 * Two definitions this repository fixes, both of which look like details and are
 * not:
 *
 *  - **The ordinal counts EVALUATED sessions, not sessions.** A session with no
 *    completed evaluation has no score to place on the curve, so counting it
 *    would leave gaps in the numbering and make "3rd session" mean different
 *    things for different learners. Ordering is by
 *    `COALESCE(s."startedAt", s."createdAt")` with `s.id` as the tiebreak, so two
 *    sessions with an identical timestamp still get a stable order rather than a
 *    different one per query.
 *  - **Both variants come from ONE pass over one denominator.** `experienced` is
 *    the same rows filtered by the learner's total evaluated count, computed in
 *    the same query — never a second query with its own definition of an
 *    evaluated session. Competing definitions computed separately drift apart,
 *    and a panel switcher that swaps between two subtly different populations is
 *    worse than one that offers a single view.
 *
 * Conventions follow the sibling repositories: `DataSource` raw SQL over tables
 * BY NAME (no entity repos), quoted camelCase identifiers (only `tenant_id` is
 * snake_case), counts `::int` and re-parsed defensively in JS, bounds as bound
 * parameters.
 */
@Injectable()
export class SkillGrowthAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The whole curve in one query.
   *
   * `evaluated` numbers each learner's judged sessions; `per_learner` counts them
   * so the experience filter is a property of the PERSON rather than of the row
   * (a filter applied per session would keep a novice's 6th session and drop
   * their 1st, which is the opposite of holding the population fixed).
   *
   * The population totals are window-level constants repeated on every row, the
   * same shape `getTopOrgsByCompletedSims` uses. No fallback query is needed for
   * the empty case: a row exists for ordinal 1 whenever any learner has a single
   * evaluated session, so no rows means no evaluated sessions means the totals
   * are genuinely zero.
   */
  async getOrdinalDistribution(
    tenantId?: string,
  ): Promise<SkillGrowthDistribution> {
    const params: unknown[] = [
      ScenarioSessionEventStatus.COMPLETED,
      ActorEvaluationStatus.COMPLETED,
      SKILL_GROWTH_EXPERIENCED_MIN_SESSIONS,
      SKILL_GROWTH_MAX_ORDINAL,
    ];
    let tenantPredicate = '';
    if (tenantId) {
      params.push(tenantId);
      tenantPredicate = `AND ${scopeToTenant('s."tenant_id"', `$${params.length}`)}`;
    }

    const rows = await this.dataSource.query(
      `
      WITH evaluated AS (
        SELECT
          s."counselorId" AS learner_id,
          d."compositeScore" AS score,
          ROW_NUMBER() OVER (
            PARTITION BY s."counselorId"
            ORDER BY COALESCE(s."startedAt", s."createdAt") ASC, s.id ASC
          ) AS ordinal
        FROM scenario_sessions s
        JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
        WHERE s."eventStatus" = $1
          AND s."counselorId" IS NOT NULL
          AND d."evaluationStatus" = $2
          AND d."compositeScore" IS NOT NULL
          AND ${countableSessionPredicate('s')}
          AND ${excludeTestTenants('s."tenant_id"')}
          ${tenantPredicate}
      ),
      per_learner AS (
        SELECT learner_id, COUNT(*)::int AS evaluated
        FROM evaluated
        GROUP BY learner_id
      ),
      totals AS (
        SELECT
          COUNT(*)::int                                  AS "learners",
          COUNT(*) FILTER (WHERE evaluated >= $3)::int   AS "experiencedLearners",
          COALESCE(SUM(evaluated), 0)::int               AS "evaluatedSessions"
        FROM per_learner
      )
      SELECT
        e.ordinal::int                                            AS "ordinal",
        ${this.percentileExpr(0.5)}                                AS "allMedian",
        ${this.percentileExpr(0.25)}                               AS "allP25",
        ${this.percentileExpr(0.75)}                               AS "allP75",
        COUNT(*)::int                                             AS "allN",
        ${this.percentileExpr(0.5, 'p.evaluated >= $3')}           AS "experiencedMedian",
        ${this.percentileExpr(0.25, 'p.evaluated >= $3')}          AS "experiencedP25",
        ${this.percentileExpr(0.75, 'p.evaluated >= $3')}          AS "experiencedP75",
        COUNT(*) FILTER (WHERE p.evaluated >= $3)::int             AS "experiencedN",
        t."learners"                                              AS "learners",
        t."experiencedLearners"                                   AS "experiencedLearners",
        t."evaluatedSessions"                                     AS "evaluatedSessions"
      FROM evaluated e
      JOIN per_learner p ON p.learner_id = e.learner_id
      CROSS JOIN totals t
      WHERE e.ordinal <= $4
      GROUP BY e.ordinal, t."learners", t."experiencedLearners", t."evaluatedSessions"
      ORDER BY e.ordinal ASC
      `,
      params,
    );

    const typed = rows as Record<string, unknown>[];
    const first = (typed[0] ?? {}) as Record<string, unknown>;

    return {
      ordinals: typed.map((r) => ({
        ordinal: Number(r.ordinal) || 0,
        all: {
          median: this.num(r.allMedian),
          p25: this.num(r.allP25),
          p75: this.num(r.allP75),
          n: Number(r.allN) || 0,
        },
        experienced: {
          median: this.num(r.experiencedMedian),
          p25: this.num(r.experiencedP25),
          p75: this.num(r.experiencedP75),
          n: Number(r.experiencedN) || 0,
        },
      })),
      learners: typed.length ? Number(first.learners) || 0 : 0,
      experiencedLearners: typed.length
        ? Number(first.experiencedLearners) || 0
        : 0,
      evaluatedSessions: typed.length
        ? Number(first.evaluatedSessions) || 0
        : 0,
    };
  }

  /**
   * `percentile_cont` over the composite score, optionally over a subset.
   *
   * The FILTER is what makes the "experienced" variant the SAME pass as "all":
   * one scan of one denominator, two aggregates. Rounded to one decimal because
   * the score is a 0-100 integer — a second decimal implies a precision the judge
   * does not have.
   *
   * Both the fraction and the filter reach an interpolated position, so both are
   * closed sets defined here rather than trusted for being ours (the filter is
   * only ever the experience predicate, whose value travels as `$3`).
   */
  private percentileExpr(
    fraction: 0.25 | 0.5 | 0.75,
    filter?: 'p.evaluated >= $3',
  ): string {
    const filterClause = filter ? ` FILTER (WHERE ${filter})` : '';
    return (
      `round((percentile_cont(${fraction}) WITHIN GROUP ` +
      `(ORDER BY e.score)${filterClause})::numeric, 1)::float`
    );
  }

  /** pg hands numerics back as strings; NULL must survive as null, not 0. */
  private num(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
}
