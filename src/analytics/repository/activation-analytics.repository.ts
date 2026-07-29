import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '../../common/constants/user.constants';
import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';
import { countableSessionPredicate } from '../util/session-eligibility.util';
import { getPlatformDataFloor } from '../util/data-floor.util';
import { AnalyticsBucket } from './platform-analytics.repository';
import { MIN_COHORT_SIZE } from './cohort-analytics.repository';

/**
 * One band of the "how long until a learner first practised?" distribution, in
 * WHOLE DAYS between the account being created and its first completed roleplay.
 *
 * Bounds are **inclusive on both ends**, like {@link ROLEPLAY_VOLUME_BANDS} and
 * deliberately unlike the minute bands on `/usage-levels`. Elapsed time is a
 * continuous quantity, so "4–7 days" would normally have to declare which side
 * owns exactly 7.0 — but the quantity being banded here is not an elapsed
 * duration, it is a COUNT of calendar days (see
 * {@link ActivationAnalyticsRepository.getActivationSnapshot}). `4–7` meaning
 * "4, 5, 6 or 7 days later" is the only reading a reader will give it, and
 * publishing it as `[4, 8)` would be technically identical and misread by
 * everyone. The convention is also stated on the panel — see
 * {@link TIME_TO_FIRST_PRACTICE_BOUNDS_NOTE}.
 *
 * The bands partition everything from day 0 upwards, so every learner who ever
 * practised is in exactly one. Learners who never practised are NOT in this list:
 * they have no first session to date, so their group can only be a residual of
 * the population (the repository returns both, the service derives it).
 *
 * They are fine at the bottom and coarse at the top because that is where the
 * onboarding decisions are. "Did they practise on the day they were given the
 * account, or did it take a week of chasing?" is the question; the difference
 * between day 40 and day 60 changes nothing anyone would do.
 *
 * This is the ONE place the bands are declared. The SQL builds one
 * `FILTER (WHERE ...)` aggregate per entry with bound parameters, and the API
 * echoes the list back so the chart's axis, colours and table columns come from
 * the server's definitions rather than a second hard-coded copy that drifts.
 */
export interface TimeToFirstPracticeBand {
  /** Admin-facing label, and the chart's x-axis tick. Fastest first. */
  label: string;
  /** Inclusive lower bound, whole days after signup. */
  minDays: number;
  /** INCLUSIVE upper bound; null for the open-ended top band. */
  maxDays: number | null;
}

export const TIME_TO_FIRST_PRACTICE_BANDS: TimeToFirstPracticeBand[] = [
  { label: 'Same day', minDays: 0, maxDays: 0 },
  { label: '1–3', minDays: 1, maxDays: 3 },
  { label: '4–7', minDays: 4, maxDays: 7 },
  { label: '8–30', minDays: 8, maxDays: 30 },
  { label: '31+', minDays: 31, maxDays: null },
];

/**
 * The bound convention, stated on the panel rather than left in an API doc.
 *
 * A banded distribution whose bounds are ambiguous is read wrongly with complete
 * confidence: the reader assumes a convention, and no part of the chart
 * contradicts them. One short sentence beside the axis is the whole fix.
 */
export const TIME_TO_FIRST_PRACTICE_BOUNDS_NOTE =
  'Whole days from signup to the first completed simulation; both bounds are ' +
  'inclusive, so "4–7" means 4, 5, 6 or 7 days later. Same day = practised on ' +
  'the calendar day the account was created.';

/**
 * Day thresholds for the cumulative activation curve — "what share had practised
 * within N days of signing up?".
 *
 * The bands say where the mass sits; this says how fast the population converts,
 * which is the shape an onboarding change is judged by. Thresholds tighten near
 * zero because that is where a working onboarding moves the curve, and they stop
 * at 90 days: past a quarter, a learner who has not started is not "slow", they
 * are a learner who did not activate, and the bands already say so.
 *
 * Cumulative counts are only meaningful against the whole population, which
 * includes the learners who never practised — so this curve deliberately shares
 * `registeredLearners` with the funnel rather than being a share of the activated.
 */
export const TIME_TO_FIRST_PRACTICE_CUMULATIVE_DAYS = [
  0, 1, 3, 7, 14, 30, 60, 90,
];

/**
 * Completed roleplays that make a learner a REPEAT practiser — the last stage of
 * the activation funnel.
 *
 * Three, because one completed simulation can be a supervised walkthrough and two
 * can be curiosity; a third is the first count that reads as a habit forming
 * rather than an induction being completed.
 */
export const ACTIVATION_REPEAT_THRESHOLD = 3;

/**
 * The activation funnel's stages, in order, with the labels the client renders.
 *
 * Declared once here and echoed to the client for the same reason the bands are:
 * a funnel's meaning is carried entirely by its stage names and their ORDER, and
 * a second copy on the client is a second definition of what "activated" means.
 * Each stage is a count of PEOPLE (not of sessions), and each is a subset of the
 * one above it, so the funnel is monotonically non-increasing by construction.
 */
export interface ActivationFunnelStage {
  /** Stable machine key — the client keys colours and copy off this, not the label. */
  key: 'signedUp' | 'startedASim' | 'completedASim' | 'threePlusCompleted';
  /** Admin-facing label. */
  label: string;
}

export const ACTIVATION_FUNNEL_STAGES: ActivationFunnelStage[] = [
  { key: 'signedUp', label: 'Signed up' },
  { key: 'startedASim', label: 'Started a simulation' },
  { key: 'completedASim', label: 'Completed one' },
  { key: 'threePlusCompleted', label: 'Completed 3+' },
];

/**
 * What the funnel's first bar is a count of.
 *
 * A funnel with an unstated denominator is the most quietly misleading chart on
 * any dashboard: every percentage below it inherits the ambiguity. Naming the
 * population on the panel means a reader who thinks "signed up" includes trainers
 * and admins can see that it does not.
 */
export const ACTIVATION_FUNNEL_DENOMINATOR_LABEL =
  'learner-role accounts, test organisations excluded';

/**
 * Smallest learner population an activation RATE may be stated for.
 *
 * Deliberately the same number as {@link MIN_COHORT_SIZE} /
 * MIN_ROLEPLAY_VOLUME_POPULATION / MIN_USAGE_POPULATION / MIN_ORG_GROUP_SIZE —
 * one floor to remember across every per-person breakdown. Below it the counts
 * still travel (a count of people is not an estimate of anything and leaks
 * nothing on its own) and the percentages do not: "33% of our learners have
 * activated" over a population of three names them to anyone who knows the org.
 */
export const MIN_ACTIVATION_POPULATION = MIN_COHORT_SIZE;

/** One bucket of the practising-learners series. */
export interface PractisingLearnersBucketRow {
  /** Bucket start as a calendar date string (yyyy-mm-dd). */
  bucket: string;
  /** Distinct people with >= 1 completed roleplay in the bucket. */
  learners: number;
  /** Completed roleplays behind that headcount. */
  sessions: number;
}

/**
 * The whole all-time activation picture, in one row: the funnel, the
 * time-to-first-practice distribution and the cumulative curve.
 */
export interface ActivationSnapshotRow {
  /** Every learner account in scope, whether or not they ever practised. */
  registeredLearners: number;
  /** Of those, learners who ever LAUNCHED a countable session. */
  startedASim: number;
  /** Of those, learners with >= 1 COMPLETED session. */
  completedASim: number;
  /** Of those, learners with >= {@link ACTIVATION_REPEAT_THRESHOLD} completed. */
  threePlusCompleted: number;
  /**
   * Learners per band, index-aligned with {@link TIME_TO_FIRST_PRACTICE_BANDS}.
   * Sums to `completedASim`.
   */
  learnersByBand: number[];
  /**
   * Learners activated within each threshold, index-aligned with
   * {@link TIME_TO_FIRST_PRACTICE_CUMULATIVE_DAYS}. Non-decreasing.
   */
  cumulativeActivated: number[];
}

/**
 * Activation analytics: is the learner population actually getting started, and
 * how long does it take them?
 *
 * The question these three shapes answer together, which no volume chart can:
 *  - the FUNNEL says how much of the population is lost at each step from an
 *    account existing to a habit forming;
 *  - the TIME-TO-FIRST-PRACTICE distribution says how long the step that matters
 *    most actually takes, which is what an onboarding change moves;
 *  - the PRACTISING-LEARNERS series says whether the number of people practising
 *    is growing, independently of how much each of them practises.
 *
 * The funnel and the distribution are ALL-TIME by construction and take no notice
 * of the window: "days from signup to first practice" is a lifetime property of a
 * person, and a learner who signed up last year and activated last week belongs in
 * the "31+" band whichever window is on screen. Computing them over the window
 * would silently exclude everyone whose signup predates it — which is most of the
 * population — and report the length of the window instead of the speed of
 * activation. Only `practisingLearners` is windowed; the response says so.
 *
 * Learner-only population, read from `user_groups` -> `groups.name` exactly as
 * {@link CohortAnalyticsRepository}, {@link UsageLevelAnalyticsRepository} and
 * {@link RoleplayVolumeAnalyticsRepository} do (including NOT filtering
 * `deletedAt`), so every card on the tab is a share of the same denominator.
 * Trainers and admins who never open a simulation would otherwise sit
 * permanently in the never-activated group and turn the funnel into a measure of
 * the role mix.
 *
 * Conventions follow the sibling repositories: `DataSource` raw SQL over tables
 * BY NAME (no entity repos), quoted camelCase identifiers (only `tenant_id` is
 * snake_case), counts `::int` and re-parsed defensively, band bounds bound as
 * parameters. Every query applies {@link countableSessionPredicate}, so preview
 * and seed rooms count as neither a start nor a completion.
 */
@Injectable()
export class ActivationAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private resolveBucket(bucket: AnalyticsBucket): AnalyticsBucket {
    // Defense-in-depth: bucket is internal, but never interpolate anything we
    // have not explicitly whitelisted.
    if (bucket === 'day') return 'day';
    if (bucket === 'month') return 'month';
    if (bucket === 'year') return 'year';
    return 'week';
  }

  /**
   * Where the platform's data begins — the left edge of an all-time window.
   * See {@link getPlatformDataFloor}. The same measurement every other analytics
   * endpoint uses, so the axes on one tab cover the same period rather than
   * nearly lining up.
   */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  /**
   * The population the funnel and the distribution are shares of: LEARNER-group
   * accounts, with the signup timestamp the day count is measured from.
   *
   * Kept deliberately identical to the sibling repositories' `learnersCte`
   * (including NOT filtering `deletedAt`, which matches `getNewUsersByBucket` and
   * the cohort grid) so the cards on the tab are over the same learners. If one
   * of them ever needs to change, all of them change together or they stop being
   * comparable.
   *
   * `$1` is always the LEARNER group name; `tenantPlaceholder` is the tenant when
   * narrowing. Both are bound parameters — the caller owns the numbering because
   * each query needs a different set of them.
   */
  private learnersCte(tenantPlaceholder?: string): string {
    const tenantPredicate = tenantPlaceholder
      ? `AND ${scopeToTenant('u."tenant_id"', tenantPlaceholder)}`
      : '';
    return `
      learners AS (
        SELECT u.id          AS user_id,
               u."createdAt" AS created_at
        FROM users u
        WHERE EXISTS (
                SELECT 1 FROM user_groups ug
                JOIN groups g ON g.id = ug."groupId"
                WHERE ug."userId" = u.id AND g.name = $1
              )
          AND ${excludeTestTenants('u."tenant_id"')}
          ${tenantPredicate}
      )`;
  }

  /**
   * The funnel, the band distribution and the cumulative curve — one pass,
   * all-time.
   *
   * One query rather than three because all three are cuts of the same per-learner
   * fact table, and the funnel's first bar is the distribution's denominator: run
   * separately, two of them could disagree about how many learners exist (a signup
   * landing between the queries is enough) and the residual "never practised"
   * group would come out negative.
   *
   * A LEFT JOIN, not an inner one: a learner with no session must survive into
   * `per_learner` with zero counts, because that group is the headline of the
   * funnel. An inner join would silently drop exactly the people the reader is
   * looking for and leave a flattering funnel behind.
   *
   * Both the population and the sessions are filtered for test orgs. The learner
   * filter alone would very nearly do it; the session-side predicate keeps the
   * definition of "a completed roleplay" byte-for-byte the same as the one the
   * volume charts use, rather than nearly the same.
   *
   * The day count is a difference of CALENDAR DATES, not of timestamps: an account
   * created at 23:50 whose learner practised at 00:10 took "1 day" by the calendar
   * and 20 minutes by the clock, and the calendar reading is the one that matches
   * the "Same day" label a reader sees. It is clamped at zero with `GREATEST` so a
   * session that somehow predates its own account lands in the first band instead
   * of falling out of every band and breaking the invariant that the bands sum to
   * `completedASim`.
   */
  async getActivationSnapshot(
    tenantId?: string,
  ): Promise<ActivationSnapshotRow> {
    const params: unknown[] = [
      UserRole.LEARNER,
      ScenarioSessionEventStatus.COMPLETED,
      ACTIVATION_REPEAT_THRESHOLD,
    ];
    let tenantPlaceholder: string | undefined;
    if (tenantId) {
      params.push(tenantId);
      tenantPlaceholder = `$${params.length}`;
    }

    // Band bounds and day thresholds travel as bound parameters like everything
    // else: the lists are module constants today, but a value interpolated
    // "because it is ours" is the habit that eventually interpolates one that is
    // not.
    const bandColumns = TIME_TO_FIRST_PRACTICE_BANDS.map((band, i) => {
      params.push(band.minDays);
      let predicate = `d.days_to_first >= $${params.length}`;
      if (band.maxDays !== null) {
        params.push(band.maxDays);
        predicate += ` AND d.days_to_first <= $${params.length}`;
      }
      return `COUNT(*) FILTER (WHERE ${predicate})::int AS "band${i}"`;
    }).join(',\n        ');

    const cumulativeColumns = TIME_TO_FIRST_PRACTICE_CUMULATIVE_DAYS.map(
      (days, i) => {
        params.push(days);
        return (
          `COUNT(*) FILTER (WHERE d.days_to_first <= $${params.length})::int ` +
          `AS "cum${i}"`
        );
      },
    ).join(',\n        ');

    const rows = await this.dataSource.query(
      `
      WITH ${this.learnersCte(tenantPlaceholder)},
      per_learner AS (
        SELECT l.user_id,
               l.created_at,
               COUNT(s.id)::int                                   AS started,
               COUNT(s.id) FILTER (WHERE s."eventStatus" = $2)::int AS completed,
               MIN(COALESCE(s."startedAt", s."createdAt"))
                 FILTER (WHERE s."eventStatus" = $2)              AS first_completed_at
        FROM learners l
        LEFT JOIN scenario_sessions s
               ON s."counselorId" = l.user_id
              AND ${countableSessionPredicate('s')}
              AND ${excludeTestTenants('s."tenant_id"')}
        GROUP BY l.user_id, l.created_at
      ),
      d AS (
        SELECT p.started,
               p.completed,
               CASE
                 WHEN p.first_completed_at IS NULL THEN NULL
                 ELSE GREATEST(
                        0,
                        (p.first_completed_at::date - p.created_at::date)
                      )
               END AS days_to_first
        FROM per_learner p
      )
      SELECT
        COUNT(*)::int                                        AS "registeredLearners",
        COUNT(*) FILTER (WHERE d.started > 0)::int            AS "startedASim",
        COUNT(*) FILTER (WHERE d.completed > 0)::int          AS "completedASim",
        COUNT(*) FILTER (WHERE d.completed >= $3)::int        AS "threePlusCompleted",
        ${bandColumns},
        ${cumulativeColumns}
      FROM d
      `,
      params,
    );

    const row = (rows[0] ?? {}) as Record<string, unknown>;

    return {
      registeredLearners: Number(row.registeredLearners) || 0,
      startedASim: Number(row.startedASim) || 0,
      completedASim: Number(row.completedASim) || 0,
      threePlusCompleted: Number(row.threePlusCompleted) || 0,
      learnersByBand: TIME_TO_FIRST_PRACTICE_BANDS.map(
        (_, i) => Number(row[`band${i}`]) || 0,
      ),
      cumulativeActivated: TIME_TO_FIRST_PRACTICE_CUMULATIVE_DAYS.map(
        (_, i) => Number(row[`cum${i}`]) || 0,
      ),
    };
  }

  /**
   * People practising per bucket, and the completed roleplays behind them.
   *
   * The two series answer different questions and are returned together because
   * the interesting reading is the ratio: a bucket where sessions rose and
   * learners did not is the same handful of people practising harder, which is a
   * very different result from the platform reaching more people.
   *
   * Bucketed on `COALESCE(startedAt, createdAt)` — when the learner sat down to
   * practise, not when the session was marked complete. The volume charts on the
   * Highlights tab bucket completions by `COALESCE(endedAt, createdAt)` because
   * they are counting finished work; this series is counting people showing up, so
   * a session that ran past midnight belongs to the day it started.
   *
   * Deliberately attributed by `scenario_sessions."counselorId"` (the person who
   * played) with NO role filter, unlike the all-time funnel: this is a count of
   * people who practised, not a share of the learner population, so a trainer
   * rehearsing counts as somebody practising. The figures that need a denominator
   * take it from the learner-role population instead, and the response keeps the
   * two apart.
   *
   * Buckets with no completed roleplays are ABSENT; the service puts them back on
   * the axis with real zeros, because these are counts and "nobody practised that
   * week" is a fact rather than a missing measurement.
   */
  async getPractisingLearnersByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    tenantId?: string,
  ): Promise<PractisingLearnersBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const qb = this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', COALESCE(s."startedAt", s."createdAt")), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('COUNT(DISTINCT s."counselorId")::int', 'learners')
      .addSelect('COUNT(*)::int', 'sessions')
      .from('scenario_sessions', 's')
      .where('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere(countableSessionPredicate('s'))
      .andWhere('COALESCE(s."startedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."startedAt", s."createdAt") < :end', { end })
      .andWhere(excludeTestTenants('s."tenant_id"'));
    if (tenantId) {
      qb.andWhere(scopeToTenant('s."tenant_id"', ':tenantId'), { tenantId });
    }
    const rows = await qb
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string; learners: number; sessions: number }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      learners: Number(r.learners) || 0,
      sessions: Number(r.sessions) || 0,
    }));
  }
}
