import { Injectable } from '@nestjs/common';

import {
  ACTIVATION_FUNNEL_DENOMINATOR_LABEL,
  ACTIVATION_FUNNEL_STAGES,
  ActivationAnalyticsRepository,
  ActivationSnapshotRow,
  MIN_ACTIVATION_POPULATION,
  TIME_TO_FIRST_PRACTICE_BANDS,
  TIME_TO_FIRST_PRACTICE_BOUNDS_NOTE,
  TIME_TO_FIRST_PRACTICE_CUMULATIVE_DAYS,
} from '../repository/activation-analytics.repository';
import {
  ActivationFunnelStageDto,
  ActivationQueryDto,
  ActivationResponseDto,
  ActivationSummaryDto,
  PractisingLearnersPointDto,
  TimeToFirstPracticeCumulativePointDto,
} from '../dto/activation-analytics.dto';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  describeWindow,
  generateBucketLabels,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Activation is a slow quantity, so the default view is the whole history: over
 * 30 days a funnel mostly reports last month's hiring, and a time-to-first-practice
 * distribution reports the length of the window (nobody can appear in the "31+"
 * band).
 */
const DEFAULT_RANGE: AnalyticsRange = 'all';

/**
 * Weekly buckets, including for the all-time window where the shared util would
 * otherwise default to months.
 *
 * A week is the cadence at which "are more people practising?" actually moves —
 * roleplay practice is scheduled in weeks, so a monthly grain averages the signal
 * away and a daily one over years is a thousand unreadable ticks. The util's
 * month default is right for the cost and volume charts it was written for; this
 * endpoint states its own preference instead of inheriting one, and either way an
 * explicit `bucket` param wins.
 */
const DEFAULT_BUCKET: AnalyticsBucket = 'week';

/**
 * Learner activation for the leadership surface.
 *
 * Thin by design — the repository answers the all-time question in one pass and
 * the windowed one in a second. What lives here are the rules that must not be
 * left to a client:
 *
 *  - **The never-practised group is a residual, derived once.** A learner with no
 *    completed session has no first-practice date, so that group can only be
 *    `registeredLearners - activatedLearners`. Two clients deriving it separately
 *    is two chances to derive it differently; it is clamped at zero here so a data
 *    anomaly shows up as an odd zero rather than as an inverted bar.
 *  - **The funnel never widens downward.** Each stage is clamped to the one above
 *    it. It is monotone by construction in SQL, but a funnel that widens as it
 *    descends reads as a broken chart rather than as a data problem, and the reader
 *    stops trusting the whole panel.
 *  - **A rate over a handful of people is not published.** Below
 *    {@link MIN_ACTIVATION_POPULATION} the counts still travel and every percentage
 *    is null. The floor itself is echoed so the client applies the server's rule.
 *  - **The in-progress bucket is not the latest value.** `latestCompleteBucket`
 *    skips it: a period that is still accruing can only rise, so quoting it as the
 *    current level reads as a collapse.
 *  - **Zero-fill counts, never rates.** The practising-learners axis is gap-filled
 *    with real zeros because "nobody practised that week" is a measurement.
 */
@Injectable()
export class ActivationAnalyticsService {
  constructor(private readonly repository: ActivationAnalyticsRepository) {}

  async getActivation(
    query: ActivationQueryDto,
  ): Promise<ActivationResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;

    const range = query.range ?? DEFAULT_RANGE;
    // An all-time window cannot be resolved from the calendar — it needs the
    // platform's first row, one extra cheap query, and only for that range. An
    // endpoint that has not measured its floor must let the window util reject
    // `range=all` rather than guess an epoch and put an invented history on the
    // axis; here it is measured, so the range is supported.
    const isAllTime = range === 'all' && !query.from && !query.to;
    const window = resolveAnalyticsWindow(
      {
        range,
        from: query.from,
        to: query.to,
        // The all-time branch of the util defaults to months; this endpoint wants
        // weeks (see DEFAULT_BUCKET). A custom from/to window keeps the util's
        // day-count-derived grain, which is the right default for an arbitrary
        // period.
        bucket: query.bucket ?? (isAllTime ? DEFAULT_BUCKET : undefined),
      },
      {
        defaultRange: DEFAULT_RANGE,
        defaultBucketFor: () => DEFAULT_BUCKET,
        allTimeStart: isAllTime
          ? await this.repository.getDataFloor()
          : undefined,
      },
    );

    const [snapshot, practisingRows] = await Promise.all([
      this.repository.getActivationSnapshot(tenantId),
      this.repository.getPractisingLearnersByBucket(
        window.start,
        window.endExclusive,
        window.bucket,
        tenantId,
      ),
    ]);

    // Counts, so the empty buckets are real zeros rather than a fabricated
    // measurement: the axis stays a true calendar and a quiet fortnight cannot
    // render as two adjacent weeks.
    const byBucket = new Map(practisingRows.map((r) => [r.bucket, r]));
    const practisingLearners: PractisingLearnersPointDto[] =
      generateBucketLabels(
        window.start,
        window.endExclusive,
        window.bucket,
      ).map((bucket) => ({
        bucket,
        learners: byBucket.get(bucket)?.learners ?? 0,
        sessions: byBucket.get(bucket)?.sessions ?? 0,
      }));

    // The population can never be smaller than the people counted inside it.
    const registeredLearners = Math.max(
      snapshot.registeredLearners,
      snapshot.startedASim,
      snapshot.completedASim,
    );
    const activatedLearners = snapshot.completedASim;

    return {
      window: describeWindow(window),
      practisingLearners,
      summary: this.buildSummary({
        practisingLearners,
        inProgressBucket: window.inProgressBucket,
        registeredLearners,
        activatedLearners,
      }),
      funnel: {
        denominatorLabel: ACTIVATION_FUNNEL_DENOMINATOR_LABEL,
        stages: this.buildFunnelStages(snapshot, registeredLearners),
      },
      timeToFirstPractice: {
        bands: TIME_TO_FIRST_PRACTICE_BANDS.map((b) => ({ ...b })),
        learnersByBand: snapshot.learnersByBand,
        neverPractised: Math.max(0, registeredLearners - activatedLearners),
        boundsNote: TIME_TO_FIRST_PRACTICE_BOUNDS_NOTE,
        cumulative: this.buildCumulative(snapshot, registeredLearners),
      },
      // Both the population (users) and the activity (scenario_sessions) carry a
      // tenant, so unlike AI cost or org counts there is nothing here that has to
      // stay platform-wide under a tenant filter.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * The headline scalars.
   *
   * `latestCompleteBucket` walks back from the end of the axis past the
   * in-progress bucket, rather than taking the last point: the current period is
   * still accruing, so its figure can only rise and quoting it as the latest level
   * reads as a fall that the reader will explain to themselves.
   */
  private buildSummary({
    practisingLearners,
    inProgressBucket,
    registeredLearners,
    activatedLearners,
  }: {
    practisingLearners: PractisingLearnersPointDto[];
    inProgressBucket: string | null;
    registeredLearners: number;
    activatedLearners: number;
  }): ActivationSummaryDto {
    const latest = [...practisingLearners]
      .reverse()
      .find((p) => p.bucket !== inProgressBucket);

    return {
      latestCompleteBucket: latest?.bucket ?? null,
      // Zero is a measurement: a complete bucket where nobody practised reports
      // zero, and only the absence of a complete bucket reports null.
      latestPractisingLearners: latest ? latest.learners : null,
      registeredLearners,
      activatedLearners,
      activationRatePct: this.ratePct(activatedLearners, registeredLearners),
      minPopulationSize: MIN_ACTIVATION_POPULATION,
    };
  }

  /**
   * Stage counts, clamped so the funnel never widens as it descends.
   *
   * The SQL makes each stage a subset of the one above it, so this is defensive:
   * the point is that a funnel with a wider bar below a narrower one reads as a
   * broken chart, and a reader who thinks the chart is broken stops believing the
   * numbers that ARE right.
   */
  private buildFunnelStages(
    snapshot: ActivationSnapshotRow,
    registeredLearners: number,
  ): ActivationFunnelStageDto[] {
    const raw: Record<string, number> = {
      signedUp: registeredLearners,
      startedASim: snapshot.startedASim,
      completedASim: snapshot.completedASim,
      threePlusCompleted: snapshot.threePlusCompleted,
    };

    let ceiling = registeredLearners;
    return ACTIVATION_FUNNEL_STAGES.map((stage) => {
      ceiling = Math.min(ceiling, raw[stage.key] ?? 0);
      return { key: stage.key, label: stage.label, reached: ceiling };
    });
  }

  /**
   * The cumulative activation curve.
   *
   * The denominator is the WHOLE learner population, including the learners who
   * never practised — a conversion curve computed over only the converted reaches
   * 100% by construction and answers nothing.
   */
  private buildCumulative(
    snapshot: ActivationSnapshotRow,
    registeredLearners: number,
  ): TimeToFirstPracticeCumulativePointDto[] {
    return TIME_TO_FIRST_PRACTICE_CUMULATIVE_DAYS.map((days, i) => {
      const activated = snapshot.cumulativeActivated[i] ?? 0;
      return {
        days,
        activated,
        activatedPct: this.ratePct(activated, registeredLearners),
      };
    });
  }

  /**
   * A percentage, or null when it must not be stated.
   *
   * Two separate reasons to withhold it, both of which are "undefined" rather than
   * "zero": a share of nobody has no value at all, and a share of a handful of
   * people identifies them.
   */
  private ratePct(numerator: number, population: number): number | null {
    if (population < MIN_ACTIVATION_POPULATION) return null;
    return round1((numerator / population) * 100);
  }
}
