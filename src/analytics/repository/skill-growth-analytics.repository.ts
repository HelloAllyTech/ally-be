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

/**
 * Evaluated sessions a learner needs before their own trend is classified at
 * all.
 *
 * Four, not six: this is a lower bar than the `experienced` variant on purpose.
 * `experienced` exists to hold a POPULATION fixed across twelve ordinals, so it
 * needs a history long enough to leave a visible slope. Classification only
 * compares one learner's first window against their last, so it needs exactly
 * enough sessions for the two windows not to share a session — any fewer and
 * "improved" would mean "their second session beat their first", which is one
 * judged conversation against another, i.e. noise.
 *
 * Must stay >= 2 * {@link SKILL_TREND_WINDOW}; the windows overlapping would
 * count the same session in both means and bias every delta toward zero.
 *
 * Chosen against local fixture data only (see SKILL_VIZ_SPIKE_FINDINGS.md at
 * the workspace root) — re-derive from the staging evaluated-sessions-per-
 * learner histogram before treating the classified share as a KPI.
 */
export const SKILL_TREND_MIN_SESSIONS = 4;

/**
 * Sessions averaged at each end of a learner's history to form their delta.
 *
 * Two because a single session is an LLM judge's read of one conversation —
 * the spread between a learner's adjacent sessions is routinely tens of
 * points, so endpoints of one session each would classify judges' noise.
 * Averaging more than two would eat most of a four-session history and drag
 * the "first" window into the sessions the learner improved during.
 */
export const SKILL_TREND_WINDOW = 2;

/**
 * Half-width of the "flat" band, in composite-score points.
 *
 * A delta within ±this is reported as flat rather than as movement. Five
 * points on a 0-100 judge score is inside the wobble two-session windows
 * carry, so calling it improvement would let leadership read the judge's
 * variance as learning. Symmetric on purpose: the cost of over-claiming
 * improvement and the cost of over-claiming decline are both credibility.
 */
export const SKILL_TREND_FLAT_BAND = 5;

/** How a classified learner's history moved. `insufficient` = too few sessions to say. */
export type SkillTrendClass =
  | 'improving'
  | 'flat'
  | 'declining'
  | 'insufficient';

/**
 * Hard cap on rows a single learner's drill-down returns.
 *
 * Not a page: nobody has hundreds of evaluated sessions today, so this is a
 * runaway guard rather than a pagination scheme — if it is ever hit the chart
 * silently showing a truncated history would be worse, which is why the
 * service compares the row count against it and flags the response.
 */
export const SKILL_GROWTH_LEARNER_SESSION_CAP = 500;

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

/** One month of the improvement mix, keyed by when learners became classifiable. */
export interface SkillTrendMixMonth {
  /** 'YYYY-MM' of each learner's {@link SKILL_TREND_MIN_SESSIONS}th evaluated session. */
  month: string;
  improving: number;
  flat: number;
  declining: number;
}

/** Improving / flat / declining, each learner against their own baseline. */
export interface SkillTrendMix {
  /** Learners with enough evaluated sessions to classify. */
  classifiedLearners: number;
  /** Learners with >= 1 but < {@link SKILL_TREND_MIN_SESSIONS} evaluated sessions. */
  insufficientLearners: number;
  improving: number;
  flat: number;
  declining: number;
  months: SkillTrendMixMonth[];
}

/** One learner's own-baseline trend, as listed for the drill-down table. */
export interface SkillTrendLearnerRow {
  learnerId: number;
  name: string | null;
  email: string | null;
  tenantId: string | null;
  evaluatedSessions: number;
  /** Mean of the first {@link SKILL_TREND_WINDOW} evaluated sessions; null when unclassified. */
  firstWindowMean: number | null;
  /** Mean of the last {@link SKILL_TREND_WINDOW} evaluated sessions; null when unclassified. */
  lastWindowMean: number | null;
  /** lastWindowMean - firstWindowMean; null when unclassified. */
  delta: number | null;
  trend: SkillTrendClass;
  lastSessionAt: string | null;
}

export interface SkillTrendLearnerPage {
  rows: SkillTrendLearnerRow[];
  /** Learners matching the scope, across every page. */
  total: number;
}

/** Sort keys the learner list accepts — a closed set, interpolated into SQL. */
export const SKILL_TREND_SORT_COLUMNS = {
  delta: '"delta"',
  evaluatedSessions: '"evaluatedSessions"',
  lastSessionAt: '"lastSessionAt"',
} as const;
export type SkillTrendSortKey = keyof typeof SKILL_TREND_SORT_COLUMNS;

/** One evaluated session on a single learner's timeline. */
export interface SkillGrowthLearnerSession {
  ordinal: number;
  occurredAt: string | null;
  scenarioTitle: string | null;
  compositeScore: number;
  /**
   * Raw `summary->'feedback'->'skillCoverage'` entries, or null — most local
   * rows have no payload at all, and the categories come in two label
   * generations (`Listening Engagement…` from ally-ai, `Learning/Support/
   * Standards` in the BE DTO), so the shape is passed through rather than
   * normalised into columns here.
   */
  skillCoverage: { category: string; percentage: number }[] | null;
}

/** One scored knowledge-side attempt (quiz or annotation) for a learner. */
export interface SkillGrowthKnowledgeAttempt {
  kind: 'quiz' | 'annotation';
  itemTitle: string | null;
  scorePct: number;
  attemptNumber: number;
  submittedAt: string | null;
}

/** The learner's identity, as the drill-down header needs it. */
export interface SkillGrowthLearnerIdentity {
  id: number;
  name: string | null;
  email: string | null;
  tenantId: string | null;
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
    const params: unknown[] = [];
    const evaluatedCte = this.evaluatedCte(params, tenantId);
    params.push(SKILL_GROWTH_EXPERIENCED_MIN_SESSIONS);
    const experiencedParam = `$${params.length}`;
    params.push(SKILL_GROWTH_MAX_ORDINAL);
    const maxOrdinalParam = `$${params.length}`;

    const rows = await this.dataSource.query(
      `
      WITH evaluated AS (${evaluatedCte}),
      per_learner AS (
        SELECT learner_id, COUNT(*)::int AS evaluated
        FROM evaluated
        GROUP BY learner_id
      ),
      totals AS (
        SELECT
          COUNT(*)::int                                  AS "learners",
          COUNT(*) FILTER (WHERE evaluated >= ${experiencedParam})::int
                                                         AS "experiencedLearners",
          COALESCE(SUM(evaluated), 0)::int               AS "evaluatedSessions"
        FROM per_learner
      )
      SELECT
        e.ordinal::int                                            AS "ordinal",
        ${this.percentileExpr(0.5)}                                AS "allMedian",
        ${this.percentileExpr(0.25)}                               AS "allP25",
        ${this.percentileExpr(0.75)}                               AS "allP75",
        COUNT(*)::int                                             AS "allN",
        ${this.percentileExpr(0.5, experiencedParam)}              AS "experiencedMedian",
        ${this.percentileExpr(0.25, experiencedParam)}             AS "experiencedP25",
        ${this.percentileExpr(0.75, experiencedParam)}             AS "experiencedP75",
        COUNT(*) FILTER (WHERE p.evaluated >= ${experiencedParam})::int
                                                                  AS "experiencedN",
        t."learners"                                              AS "learners",
        t."experiencedLearners"                                   AS "experiencedLearners",
        t."evaluatedSessions"                                     AS "evaluatedSessions"
      FROM evaluated e
      JOIN per_learner p ON p.learner_id = e.learner_id
      CROSS JOIN totals t
      WHERE e.ordinal <= ${maxOrdinalParam}
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
   * Improving / flat / declining, every learner against their own baseline.
   *
   * The classification the ordinal curve cannot give: the curve is the
   * population's median at each ordinal, so an individual improving while
   * another declines nets out of it. Here each learner's LAST
   * {@link SKILL_TREND_WINDOW} evaluated sessions are compared against their
   * FIRST, and the delta lands in one of three buckets around
   * {@link SKILL_TREND_FLAT_BAND}.
   *
   * The monthly rows bucket learners by the month they became CLASSIFIABLE —
   * their {@link SKILL_TREND_MIN_SESSIONS}th evaluated session — not by
   * calendar activity. Bucketing by activity would re-classify the same
   * learner every month and the bars would sum to more than the population;
   * this way each classified learner appears in exactly one bar.
   */
  async getTrendMix(tenantId?: string): Promise<SkillTrendMix> {
    const params: unknown[] = [];
    const evaluatedCte = this.evaluatedCte(params, tenantId);
    const { minParam, windowParam, bandParam } = this.pushTrendParams(params);

    const rows = await this.dataSource.query(
      `
      WITH evaluated AS (${evaluatedCte}),
      classified AS (${this.classifiedCte(minParam, windowParam, bandParam)})
      SELECT
        CASE WHEN c.evaluated >= ${minParam}
             THEN to_char(date_trunc('month', c.classified_at), 'YYYY-MM')
        END                                                   AS "month",
        COUNT(*) FILTER (WHERE c.trend = 'improving')::int    AS "improving",
        COUNT(*) FILTER (WHERE c.trend = 'flat')::int         AS "flat",
        COUNT(*) FILTER (WHERE c.trend = 'declining')::int    AS "declining",
        COUNT(*) FILTER (WHERE c.trend = 'insufficient')::int AS "insufficient"
      FROM classified c
      GROUP BY 1
      ORDER BY 1 ASC NULLS FIRST
      `,
      params,
    );

    const typed = rows as Record<string, unknown>[];
    const months: SkillTrendMixMonth[] = [];
    let improving = 0;
    let flat = 0;
    let declining = 0;
    let insufficientLearners = 0;
    for (const r of typed) {
      if (r.month === null || r.month === undefined) {
        // The unclassified learners all fall in the NULL-month row.
        insufficientLearners += Number(r.insufficient) || 0;
        continue;
      }
      const row: SkillTrendMixMonth = {
        month: String(r.month),
        improving: Number(r.improving) || 0,
        flat: Number(r.flat) || 0,
        declining: Number(r.declining) || 0,
      };
      months.push(row);
      improving += row.improving;
      flat += row.flat;
      declining += row.declining;
    }

    return {
      classifiedLearners: improving + flat + declining,
      insufficientLearners,
      improving,
      flat,
      declining,
      months,
    };
  }

  /**
   * One page of learners with their own-baseline trend, for the drill-down
   * table.
   *
   * Unclassified learners are listed rather than hidden — a leadership table
   * that silently omits most of the population invites "where is everyone?"
   * — but their window means and delta come back null, because a mean whose
   * two windows share sessions (fewer than 2×window sessions) is biased
   * toward zero and would be read as "flat".
   *
   * The sort column is a closed set ({@link SKILL_TREND_SORT_COLUMNS});
   * anything else here would be string interpolation of caller input into SQL.
   */
  async getLearnerTrendPage(options: {
    tenantId?: string;
    limit: number;
    offset: number;
    sort: SkillTrendSortKey;
    descending: boolean;
  }): Promise<SkillTrendLearnerPage> {
    const params: unknown[] = [];
    const evaluatedCte = this.evaluatedCte(params, options.tenantId);
    const { minParam, windowParam, bandParam } = this.pushTrendParams(params);
    params.push(options.limit);
    const limitParam = `$${params.length}`;
    params.push(options.offset);
    const offsetParam = `$${params.length}`;

    const sortColumn = SKILL_TREND_SORT_COLUMNS[options.sort];
    const direction = options.descending ? 'DESC' : 'ASC';

    const rows = await this.dataSource.query(
      `
      WITH evaluated AS (${evaluatedCte}),
      classified AS (${this.classifiedCte(minParam, windowParam, bandParam)})
      SELECT
        c.learner_id::int                       AS "learnerId",
        u.name                                  AS "name",
        u.email                                 AS "email",
        u."tenant_id"                           AS "tenantId",
        c.evaluated                             AS "evaluatedSessions",
        c.first_mean                            AS "firstWindowMean",
        c.last_mean                             AS "lastWindowMean",
        c.delta                                 AS "delta",
        c.trend                                 AS "trend",
        c.last_session_at                       AS "lastSessionAt",
        COUNT(*) OVER ()::int                   AS "total"
      FROM classified c
      LEFT JOIN users u ON u.id = c.learner_id
      ORDER BY ${sortColumn} ${direction} NULLS LAST, c.learner_id ASC
      LIMIT ${limitParam} OFFSET ${offsetParam}
      `,
      params,
    );

    const typed = rows as Record<string, unknown>[];
    return {
      rows: typed.map((r) => ({
        learnerId: Number(r.learnerId) || 0,
        name: (r.name as string | null) ?? null,
        email: (r.email as string | null) ?? null,
        tenantId: (r.tenantId as string | null) ?? null,
        evaluatedSessions: Number(r.evaluatedSessions) || 0,
        firstWindowMean: this.num(r.firstWindowMean),
        lastWindowMean: this.num(r.lastWindowMean),
        delta: this.num(r.delta),
        trend: (r.trend as SkillTrendClass) ?? 'insufficient',
        lastSessionAt: this.iso(r.lastSessionAt),
      })),
      total: typed.length ? Number(typed[0].total) || 0 : 0,
    };
  }

  /** The learner as the drill-down header shows them; null when no such user. */
  async getLearnerIdentity(
    learnerId: number,
  ): Promise<SkillGrowthLearnerIdentity | null> {
    const rows = await this.dataSource.query(
      `
      SELECT u.id::int AS "id", u.name AS "name", u.email AS "email",
             u."tenant_id" AS "tenantId"
      FROM users u
      WHERE u.id = $1
      `,
      [learnerId],
    );
    const typed = rows as Record<string, unknown>[];
    if (!typed.length) return null;
    return {
      id: Number(typed[0].id) || 0,
      name: (typed[0].name as string | null) ?? null,
      email: (typed[0].email as string | null) ?? null,
      tenantId: (typed[0].tenantId as string | null) ?? null,
    };
  }

  /**
   * Every evaluated session of ONE learner, oldest first, with whatever
   * per-skill payload the evaluation left behind.
   *
   * Same eligibility predicates as the aggregate CTE — a session the platform
   * curve would not count must not appear on the individual's line either, or
   * the drill-down "explains" a curve it is not drawn from. The scenario title
   * travels so a reader can see a score dip coincide with a scenario change
   * (difficulty mix is the known confound the spike could not measure).
   */
  async getLearnerSessions(
    learnerId: number,
  ): Promise<SkillGrowthLearnerSession[]> {
    const params: unknown[] = [];
    const evaluatedCte = this.evaluatedCte(params, undefined, learnerId);

    const rows = await this.dataSource.query(
      `
      WITH evaluated AS (${evaluatedCte})
      SELECT
        e.ordinal::int                              AS "ordinal",
        e.occurred_at                               AS "occurredAt",
        sc.title                                    AS "scenarioTitle",
        e.score::int                                AS "compositeScore",
        d.summary->'feedback'->'skillCoverage'      AS "skillCoverage"
      FROM evaluated e
      LEFT JOIN scenarios sc ON sc.id = e.scenario_id
      JOIN scenario_session_details d ON d."scenarioSessionId" = e.session_id
      ORDER BY e.ordinal ASC
      LIMIT ${SKILL_GROWTH_LEARNER_SESSION_CAP}
      `,
      params,
    );

    const typed = rows as Record<string, unknown>[];
    return typed.map((r) => ({
      ordinal: Number(r.ordinal) || 0,
      occurredAt: this.iso(r.occurredAt),
      scenarioTitle: (r.scenarioTitle as string | null) ?? null,
      compositeScore: Number(r.compositeScore) || 0,
      skillCoverage: this.parseSkillCoverage(r.skillCoverage),
    }));
  }

  /**
   * One learner's scored quiz and annotation attempts, oldest first — the
   * knowledge-side series, kept apart from the roleplay series on purpose
   * (blending was explicitly scoped out: an invented weighting hides which
   * signal moved).
   */
  async getLearnerKnowledgeAttempts(
    learnerId: number,
  ): Promise<SkillGrowthKnowledgeAttempt[]> {
    const rows = await this.dataSource.query(
      `
      SELECT * FROM (
        SELECT
          'quiz'                 AS "kind",
          ti.title               AS "itemTitle",
          a."scorePct"::float    AS "scorePct",
          a."attemptNumber"::int AS "attemptNumber",
          a."submittedAt"        AS "submittedAt"
        FROM track_quiz_attempts a
        LEFT JOIN track_items ti ON ti.id = a."trackItemId"
        WHERE a."userId" = $1
          AND a."scorePct" IS NOT NULL
          AND a."deletedAt" IS NULL
        UNION ALL
        SELECT
          'annotation'           AS "kind",
          ti.title               AS "itemTitle",
          a."scorePct"::float    AS "scorePct",
          a."attemptNumber"::int AS "attemptNumber",
          a."submittedAt"        AS "submittedAt"
        FROM track_annotation_attempts a
        LEFT JOIN track_items ti ON ti.id = a."trackItemId"
        WHERE a."userId" = $1
          AND a."scorePct" IS NOT NULL
          AND a."deletedAt" IS NULL
      ) attempts
      ORDER BY "submittedAt" ASC NULLS LAST
      LIMIT ${SKILL_GROWTH_LEARNER_SESSION_CAP}
      `,
      [learnerId],
    );

    const typed = rows as Record<string, unknown>[];
    return typed.map((r) => ({
      kind: r.kind === 'annotation' ? 'annotation' : 'quiz',
      itemTitle: (r.itemTitle as string | null) ?? null,
      scorePct: this.num(r.scorePct) ?? 0,
      attemptNumber: Number(r.attemptNumber) || 0,
      submittedAt: this.iso(r.submittedAt),
    }));
  }

  /**
   * The one definition of an evaluated session, shared by every query here.
   *
   * The repository's own warning applies to itself: two hand-copied versions
   * of this CTE would eventually disagree about what counts as evaluated, and
   * a learner's drill-down would "explain" a curve it is not drawn from.
   * Callers pass the SAME params array the final query will run with; the
   * fragment appends its bound values and refers to them by position.
   */
  private evaluatedCte(
    params: unknown[],
    tenantId?: string,
    learnerId?: number,
  ): string {
    params.push(ScenarioSessionEventStatus.COMPLETED);
    const eventParam = `$${params.length}`;
    params.push(ActorEvaluationStatus.COMPLETED);
    const evalParam = `$${params.length}`;
    let tenantPredicate = '';
    if (tenantId) {
      params.push(tenantId);
      tenantPredicate = `AND ${scopeToTenant('s."tenant_id"', `$${params.length}`)}`;
    }
    let learnerPredicate = '';
    if (learnerId !== undefined) {
      params.push(learnerId);
      learnerPredicate = `AND s."counselorId" = $${params.length}`;
    }
    return `
        SELECT
          s.id AS session_id,
          s."scenarioId" AS scenario_id,
          s."counselorId" AS learner_id,
          d."compositeScore" AS score,
          COALESCE(s."startedAt", s."createdAt") AS occurred_at,
          ROW_NUMBER() OVER (
            PARTITION BY s."counselorId"
            ORDER BY COALESCE(s."startedAt", s."createdAt") ASC, s.id ASC
          ) AS ordinal,
          ROW_NUMBER() OVER (
            PARTITION BY s."counselorId"
            ORDER BY COALESCE(s."startedAt", s."createdAt") DESC, s.id DESC
          ) AS rev_ordinal
        FROM scenario_sessions s
        JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
        WHERE s."eventStatus" = ${eventParam}
          AND s."counselorId" IS NOT NULL
          AND d."evaluationStatus" = ${evalParam}
          AND d."compositeScore" IS NOT NULL
          AND ${countableSessionPredicate('s')}
          AND ${excludeTestTenants('s."tenant_id"')}
          ${tenantPredicate}
          ${learnerPredicate}`;
  }

  /**
   * Per-learner window means and trend class, on top of `evaluated`.
   *
   * `rev_ordinal` is what makes "last window" a real window rather than
   * "sessions after N-minus-2", which shifts meaning as N grows. Window means
   * and delta are nulled for unclassified learners INSIDE the SQL so no caller
   * can accidentally print an overlapping-window mean.
   */
  private classifiedCte(
    minParam: string,
    windowParam: string,
    bandParam: string,
  ): string {
    return `
        SELECT
          learner_id,
          COUNT(*)::int AS evaluated,
          MAX(occurred_at) AS last_session_at,
          MAX(occurred_at) FILTER (WHERE ordinal = ${minParam}) AS classified_at,
          CASE WHEN COUNT(*) >= ${minParam} THEN
            round(AVG(score) FILTER (WHERE ordinal <= ${windowParam})::numeric, 1)::float
          END AS first_mean,
          CASE WHEN COUNT(*) >= ${minParam} THEN
            round(AVG(score) FILTER (WHERE rev_ordinal <= ${windowParam})::numeric, 1)::float
          END AS last_mean,
          CASE WHEN COUNT(*) >= ${minParam} THEN
            round((AVG(score) FILTER (WHERE rev_ordinal <= ${windowParam})
                 - AVG(score) FILTER (WHERE ordinal <= ${windowParam}))::numeric, 1)::float
          END AS delta,
          CASE
            WHEN COUNT(*) < ${minParam} THEN 'insufficient'
            WHEN AVG(score) FILTER (WHERE rev_ordinal <= ${windowParam})
               - AVG(score) FILTER (WHERE ordinal <= ${windowParam}) > ${bandParam}
              THEN 'improving'
            WHEN AVG(score) FILTER (WHERE rev_ordinal <= ${windowParam})
               - AVG(score) FILTER (WHERE ordinal <= ${windowParam}) < -${bandParam}
              THEN 'declining'
            ELSE 'flat'
          END AS trend
        FROM evaluated
        GROUP BY learner_id`;
  }

  /** Bind the three trend thresholds and hand back their placeholders. */
  private pushTrendParams(params: unknown[]): {
    minParam: string;
    windowParam: string;
    bandParam: string;
  } {
    params.push(SKILL_TREND_MIN_SESSIONS);
    const minParam = `$${params.length}`;
    params.push(SKILL_TREND_WINDOW);
    const windowParam = `$${params.length}`;
    params.push(SKILL_TREND_FLAT_BAND);
    const bandParam = `$${params.length}`;
    return { minParam, windowParam, bandParam };
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
   * only ever the experience predicate; callers pass the PLACEHOLDER its value
   * travels as, e.g. `$3`, never the value).
   */
  private percentileExpr(
    fraction: 0.25 | 0.5 | 0.75,
    experiencedParam?: string,
  ): string {
    const filterClause = experiencedParam
      ? ` FILTER (WHERE p.evaluated >= ${experiencedParam})`
      : '';
    return (
      `round((percentile_cont(${fraction}) WITHIN GROUP ` +
      `(ORDER BY e.score)${filterClause})::numeric, 1)::float`
    );
  }

  /**
   * The `skillCoverage` payload survives as data, not as trust: entries are
   * whatever ally-ai wrote (two label generations exist), so anything that is
   * not a {category, percentage} pair is dropped rather than guessed at.
   */
  private parseSkillCoverage(
    value: unknown,
  ): { category: string; percentage: number }[] | null {
    if (!Array.isArray(value)) return null;
    const entries = value
      .map((e) => {
        if (typeof e !== 'object' || e === null) return null;
        const category = (e as Record<string, unknown>).category;
        const percentage = this.num((e as Record<string, unknown>).percentage);
        if (typeof category !== 'string' || percentage === null) return null;
        return { category, percentage };
      })
      .filter((e): e is { category: string; percentage: number } => e !== null);
    return entries.length ? entries : null;
  }

  /** pg timestamps arrive as Date or string depending on driver mood. */
  private iso(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  /** pg hands numerics back as strings; NULL must survive as null, not 0. */
  private num(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
}
