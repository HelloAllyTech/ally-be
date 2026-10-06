import { Injectable } from '@nestjs/common';

import { AnalyticsRange } from '../dto/platform-analytics.dto';
import {
  QualifiedSessionPointDto,
  QualifiedSessionsQueryDto,
  QualifiedSessionsResponseDto,
  StickinessQueryDto,
  StickinessResponseDto,
  StickinessSpacingBandDto,
  StickinessSpacingDto,
  StickinessStepDto,
} from '../dto/practice-depth-analytics.dto';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  ActiveDayHistogramRow,
  MIN_STICKINESS_POPULATION,
  PracticeDepthAnalyticsRepository,
  QUALIFYING_MINUTES,
  STICKINESS_STEPS,
  SessionGapRow,
} from '../repository/practice-depth-analytics.repository';
// One floor for every stated share of observations — see SkillGrowthAnalyticsService.
import { MIN_SCORE_SAMPLE_SIZE } from '../repository/quality-distribution-analytics.repository';
import {
  describeWindow,
  generateBucketLabels,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';
import { withReportingQuerySlot } from '../../common/util/reporting-query-slots.util';

/**
 * Bucket granularity per range for the qualifying-session trend.
 *
 * The same mapping the highlights charts use — a count per bucket needs no
 * minimum sample to be meaningful, so there is no reason to be coarser here than
 * the reader asked for.
 */
const defaultBucketFor = (range: AnalyticsRange): AnalyticsBucket => {
  if (range === '30d') return 'day';
  if (range === '90d') return 'week';
  return 'month';
};

@Injectable()
export class PracticeDepthAnalyticsService {
  constructor(private readonly repo: PracticeDepthAnalyticsRepository) {}

  /**
   * The stickiness funnel: of the learners who practised once, how many came
   * back, and again.
   *
   * Four rules live here rather than in the client:
   *
   *  - **The funnel is a suffix sum, computed once.** Step N is "at least N
   *    qualifying days", built from the histogram from the top down. Doing it on
   *    the client means every client re-derives it, and the tail aggregate
   *    stops reconciling the first time one of them rounds differently.
   *  - **Percentages are suppressed below the group-size floor, server-side.**
   *    "67% of 3 learners" identifies someone to anyone who knows the org. The
   *    counts stay — a count leaks nothing on its own.
   *  - **A share over a zero denominator is null, not 0%.** No learners at a rung
   *    means the next rung's conversion is undefined; drawing it as zero reports a
   *    collapse that did not happen.
   *  - **The tail is aggregated, never dropped.** Learners past the last rung are
   *    counted in `beyondLastStep`, so the funnel still reconciles with the
   *    population instead of quietly losing the deepest users.
   *
   * `spacing` (AAQ-224) rides on the same response: how far apart a learner's
   * countable sessions are, all-time, over the same learners — see
   * {@link buildPracticeSpacing}.
   */
  async getStickiness(
    query: StickinessQueryDto,
  ): Promise<StickinessResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;
    const [histogram, gapRows] = await Promise.all([
      withReportingQuerySlot(() => this.repo.getActiveDayHistogram(tenantId)),
      withReportingQuerySlot(() => this.repo.getSessionGaps(tenantId)),
    ]);

    const steps = buildSteps(histogram);
    const totalLearners = steps[0]?.learners ?? 0;

    return {
      qualifyingMinutes: QUALIFYING_MINUTES,
      steps: applyPopulationFloor(steps),
      beyondLastStep: countAtLeast(histogram, STICKINESS_STEPS + 1),
      medianActiveDays: medianActiveDays(histogram, totalLearners),
      minPopulation: MIN_STICKINESS_POPULATION,
      spacing: buildPracticeSpacing(gapRows),
      // Both the population (users) and the activity (user_daily_scores) carry a
      // tenant, so nothing here stays platform-wide under a tenant filter.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Completed roleplay sessions long enough to be practice, over time.
   *
   * Gap-filled with real zeros, unlike the mean-bearing series on this tab: a
   * count has a meaningful zero, and "no session ran that week" is a fact about
   * that week rather than a missing measurement. The SHARE is still null over a
   * zero denominator — 0/0 is not 0%.
   */
  async getQualifiedSessions(
    query: QualifiedSessionsQueryDto,
  ): Promise<QualifiedSessionsResponseDto> {
    const needsFloor =
      (query.range ?? 'all') === 'all' && !query.from && !query.to;
    const window = resolveAnalyticsWindow(query, {
      defaultRange: 'all',
      defaultBucketFor,
      allTimeStart: needsFloor ? await this.repo.getDataFloor() : undefined,
    });
    const tenantId = query.tenantId?.trim() || undefined;
    const { start, endExclusive, bucket } = window;

    const rows = await this.repo.getQualifiedSessionsByBucket(
      start,
      endExclusive,
      bucket,
      tenantId,
    );
    const byBucket = new Map(rows.map((r) => [r.bucket, r]));

    const points: QualifiedSessionPointDto[] = generateBucketLabels(
      start,
      endExclusive,
      bucket,
    ).map((bucketKey) => {
      const row = byBucket.get(bucketKey);
      const qualifiedSessions = row?.qualifiedSessions ?? 0;
      const completedSessions = row?.completedSessions ?? 0;
      return {
        bucket: bucketKey,
        qualifiedSessions,
        completedSessions,
        qualifiedSharePct:
          completedSessions > 0
            ? Math.round((qualifiedSessions / completedSessions) * 1000) / 10
            : null,
      };
    });

    return {
      range: window.custom ? '30d' : ((query.range ?? 'all') as AnalyticsRange),
      bucket,
      window: describeWindow(window),
      qualifyingMinutes: QUALIFYING_MINUTES,
      points,
      // Summed from the RAW rows, not the gap-filled axis: identical today, but
      // a total taken from the thing being displayed cannot catch a bug in the
      // axis maths, and this is the figure a reader quotes.
      totalQualifiedSessions: rows.reduce(
        (sum, r) => sum + r.qualifiedSessions,
        0,
      ),
      totalCompletedSessions: rows.reduce(
        (sum, r) => sum + r.completedSessions,
        0,
      ),
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }
}

/** Learners with at least `n` qualifying days — a suffix sum of the histogram. */
function countAtLeast(histogram: ActiveDayHistogramRow[], n: number): number {
  return histogram
    .filter((row) => row.activeDays >= n)
    .reduce((sum, row) => sum + row.learners, 0);
}

/**
 * The nested funnel, with both conversions attached.
 *
 * Labels are phrased as the behaviour rather than the arithmetic — "Came back
 * twice" reads as a thing a person did, where "≥3 active days" makes the reader
 * translate before they can think about it.
 */
function buildSteps(histogram: ActiveDayHistogramRow[]): StickinessStepDto[] {
  const steps: StickinessStepDto[] = [];
  for (let step = 1; step <= STICKINESS_STEPS; step += 1) {
    const learners = countAtLeast(histogram, step);
    const previous = steps[steps.length - 1]?.learners;
    steps.push({
      step,
      label: stepLabel(step),
      learners,
      ofPreviousPct: pct(learners, previous),
      ofTopPct: pct(learners, steps[0]?.learners ?? learners),
    });
  }
  return steps;
}

function stepLabel(step: number): string {
  if (step === 1) return 'Practised once';
  if (step === 2) return 'Came back once';
  return `Came back ${step - 1} times`;
}

function pct(numerator: number, denominator?: number): number | null {
  if (denominator === undefined || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * Null every share whose DENOMINATOR is below the floor.
 *
 * The denominator is what a percentage exposes: "50% of 4 learners" names two
 * people whatever the numerator is. `ofTopPct` is judged against the first rung
 * and `ofPreviousPct` against the rung above it, so a funnel can legitimately
 * keep its early shares and lose its later ones — which is the honest outcome
 * when the population thins out as it descends.
 */
function applyPopulationFloor(steps: StickinessStepDto[]): StickinessStepDto[] {
  const top = steps[0]?.learners ?? 0;
  return steps.map((step, i) => {
    const previous = i > 0 ? steps[i - 1].learners : undefined;
    return {
      ...step,
      ofTopPct: top >= MIN_STICKINESS_POPULATION ? step.ofTopPct : null,
      ofPreviousPct:
        previous !== undefined && previous >= MIN_STICKINESS_POPULATION
          ? step.ofPreviousPct
          : null,
    };
  });
}

/**
 * Median qualifying days among learners who have at least one.
 *
 * Median rather than mean because the distribution is heavily right-skewed — a
 * handful of learners with hundreds of active days would pull a mean well above
 * anything a typical learner does, and report a platform far stickier than it is.
 *
 * Counts are suppressed below the floor for the same reason the shares are: over
 * a population of three, the median IS one of them.
 */
function medianActiveDays(
  histogram: ActiveDayHistogramRow[],
  totalLearners: number,
): number | null {
  if (totalLearners < MIN_STICKINESS_POPULATION) return null;

  const midpoint = totalLearners / 2;
  let seen = 0;
  for (const row of [...histogram].sort(
    (a, b) => a.activeDays - b.activeDays,
  )) {
    seen += row.learners;
    if (seen >= midpoint) return row.activeDays;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Practice spacing (EFF-51, AAQ-224)                                         */
/* -------------------------------------------------------------------------- */

/**
 * Gap bands, in whole days between consecutive session starts.
 *
 * The edges follow how practice is planned rather than an even split: same or
 * next day (massed), within the week, one to two weeks, two to four weeks, and
 * a month or more (a break). `minDays`/`maxDays` are inclusive; the last band
 * is open.
 */
export const SPACING_BANDS: readonly {
  band: string;
  label: string;
  minDays: number;
  maxDays: number | null;
}[] = [
  { band: '0-1', label: '0–1 days', minDays: 0, maxDays: 1 },
  { band: '2-6', label: '2–6 days', minDays: 2, maxDays: 6 },
  { band: '7-13', label: '7–13 days', minDays: 7, maxDays: 13 },
  { band: '14-29', label: '14–29 days', minDays: 14, maxDays: 29 },
  { band: '30+', label: '30+ days', minDays: 30, maxDays: null },
];

/** A learner whose median gap is at most this many days "comes back weekly". */
export const SPACING_TARGET_DAYS = 7;

const inBand = (gap: number, b: (typeof SPACING_BANDS)[number]) =>
  gap >= b.minDays && (b.maxDays === null || gap <= b.maxDays);

/** Median of a non-empty list; the mean of the middle two for an even count. */
function medianOf(xs: readonly number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The spacing block, from each learner's gaps.
 *
 * Two readings, deliberately different in what they count:
 *
 *  - **The histogram counts gaps.** Its question is "what does the platform's
 *    practice rhythm look like", and a learner with 40 sessions really did
 *    produce 39 gaps. Shares are withheld below {@link MIN_SCORE_SAMPLE_SIZE}
 *    gaps in total; the counts stay.
 *  - **The KPI counts people.** "Share of active learners whose median gap is
 *    within a week" gives every learner one vote, so the heaviest practisers
 *    cannot carry it. It is a share of PEOPLE, so it takes the privacy floor
 *    ({@link MIN_STICKINESS_POPULATION}), as the funnel's shares do.
 *
 * A zero denominator is null, never 0%.
 */
export function buildPracticeSpacing(
  rows: readonly SessionGapRow[],
  opts: { gapFloor?: number; learnerFloor?: number } = {},
): StickinessSpacingDto {
  const gapFloor = opts.gapFloor ?? MIN_SCORE_SAMPLE_SIZE;
  const learnerFloor = opts.learnerFloor ?? MIN_STICKINESS_POPULATION;
  const withSessions = rows.filter((r) => r.sessions > 0);
  const active = withSessions.filter((r) => r.gaps.length > 0);
  const totalGaps = active.reduce((sum, r) => sum + r.gaps.length, 0);

  const bands: StickinessSpacingBandDto[] = SPACING_BANDS.map((b) => {
    let gaps = 0;
    let learners = 0;
    for (const r of active) {
      const n = r.gaps.filter((g) => inBand(g, b)).length;
      gaps += n;
      if (n > 0) learners += 1;
    }
    return {
      band: b.band,
      label: b.label,
      minDays: b.minDays,
      maxDays: b.maxDays,
      gaps,
      sharePct:
        totalGaps >= gapFloor && totalGaps > 0
          ? Math.round((gaps / totalGaps) * 1000) / 10
          : null,
      learners,
    };
  });

  const medians = active.map((r) => medianOf(r.gaps));
  const withinTarget = medians.filter((m) => m <= SPACING_TARGET_DAYS).length;
  const enoughLearners = active.length >= learnerFloor && active.length > 0;

  return {
    window: 'all',
    bands,
    totalGaps,
    minGapSample: gapFloor,
    learnersWithSessions: withSessions.length,
    activeLearners: active.length,
    targetDays: SPACING_TARGET_DAYS,
    learnersWithinTarget: withinTarget,
    withinTargetPct: enoughLearners
      ? Math.round((withinTarget / active.length) * 1000) / 10
      : null,
    medianGapDays: enoughLearners
      ? Math.round(medianOf(medians) * 10) / 10
      : null,
    minLearners: learnerFloor,
    provenance: {
      derivation:
        'Every countable roleplay session (ended, completed, not a preview or seed room) of ' +
        'every learner, ordered by start. A gap is the whole days from one session start to ' +
        'the next (0 = within 24 hours), banded 0–1 / 2–6 / 7–13 / 14–29 / 30+. The KPI gives ' +
        `each learner with 2+ sessions one vote: is their median gap ${SPACING_TARGET_DAYS} days or ` +
        'less? All time; learners as in the funnel; test organisations excluded.',
      note:
        'Spacing is chosen by the learner, so this describes practice rhythm; it does not ' +
        'show that spaced practice works better here. Back-to-back sessions in one sitting ' +
        'count as 0-day gaps. Heavy practisers contribute more gaps to the bars — the KPI is ' +
        `per learner for that reason. Shares are withheld below ${gapFloor} gaps and the KPI ` +
        `below ${learnerFloor} active learners.`,
    },
  };
}
