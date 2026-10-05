import { Injectable } from '@nestjs/common';

import { AnalyticsRange } from '../dto/platform-analytics.dto';
import {
  PracticeQualityPointDto,
  PracticeQualityQueryDto,
  PracticeQualityResponseDto,
  PracticeQualitySummaryDto,
} from '../dto/practice-quality-analytics.dto';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  PRACTICE_THRESHOLDS,
  PracticeQualityAnalyticsRepository,
  PracticeQualityRow,
} from '../repository/practice-quality-analytics.repository';
// One floor for every derived rate or percentile on the platform.
import { MIN_SCORE_SAMPLE_SIZE } from '../repository/quality-distribution-analytics.repository';
import {
  describeWindow,
  generateBucketLabels,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';
import { withReportingQuerySlot } from '../../common/util/reporting-query-slots.util';

/**
 * Bucket granularity per range. Coarser than the count charts beside it, as on
 * the quality-distribution card: every number here is a percentile or a share
 * that needs `MIN_SCORE_SAMPLE_SIZE` sessions per bucket, and a daily axis over
 * 30 days would withhold nearly every point. `all` resolves to month in the
 * window util.
 */
const defaultBucketFor = (range: AnalyticsRange): AnalyticsBucket =>
  range === '12m' ? 'month' : 'week';

const round1 = (v: number): number => Math.round(v * 10) / 10;

const pct = (n: number, d: number, floor: number): number | null =>
  d >= floor && d > 0 ? round1((n / d) * 100) : null;

const floored = (v: number | null, n: number, floor: number): number | null =>
  v !== null && n >= floor ? round1(v) : null;

type Shaped = Omit<PracticeQualityPointDto, 'bucket'>;

function shape(row: PracticeQualityRow | undefined, floor: number): Shaped {
  const sessions = row?.sessions ?? 0;
  const talkShareSessions = row?.talkShareSessions ?? 0;
  const practiceSessions = row?.practiceSessions ?? 0;
  const shortTurnSessions = row?.shortTurnSessions ?? 0;
  return {
    sessions,
    talkShareSessions,
    talkShareMedianPct: floored(
      row?.talkShareMedian ?? null,
      talkShareSessions,
      floor,
    ),
    talkShareP25Pct: floored(
      row?.talkShareP25 ?? null,
      talkShareSessions,
      floor,
    ),
    talkShareP75Pct: floored(
      row?.talkShareP75 ?? null,
      talkShareSessions,
      floor,
    ),
    learnerTurnsMedian: floored(
      row?.learnerTurnsMedian ?? null,
      sessions,
      floor,
    ),
    practiceSessions,
    practicePct: pct(practiceSessions, sessions, floor),
    shortTurnSessions,
    shortTurnsPct: pct(shortTurnSessions, sessions, floor),
  };
}

/**
 * The response body apart from its constants, from the repository rows. Pure,
 * so the floors and the gap-fill are tested without a database.
 *
 * - Every bucket in the window is present: counts get real zeros (nobody
 *   practised is a fact), while every percentile, median and share is null over
 *   fewer than `floor` sessions — including an empty bucket, where 0 ÷ 0 is
 *   not 0%.
 * - The summary is the whole window computed over the raw sessions in SQL, not
 *   re-derived from the buckets: a median of bucket medians is not a median.
 */
export function buildPracticeQuality(
  rows: readonly PracticeQualityRow[],
  labels: readonly string[],
  floor: number,
): { points: PracticeQualityPointDto[]; summary: PracticeQualitySummaryDto } {
  const byBucket = new Map(
    rows
      .filter((r): r is PracticeQualityRow & { bucket: string } => !!r.bucket)
      .map((r) => [r.bucket, r]),
  );
  const points = labels.map((bucket) => ({
    bucket,
    ...shape(byBucket.get(bucket), floor),
  }));
  const total = shape(
    rows.find((r) => r.bucket === null),
    floor,
  );
  const { shortTurnsPct, ...rest } = total;
  return {
    points,
    summary: { ...rest, notPracticeShortTurnsPct: shortTurnsPct },
  };
}

/**
 * Was it practice? (Highlights → Usage, AAQ-208 / AAQ-209.) Learner talk share
 * and turns per countable session, and the share of sessions that held enough
 * of the learner's own speech to count as practice.
 */
@Injectable()
export class PracticeQualityAnalyticsService {
  constructor(private readonly repo: PracticeQualityAnalyticsRepository) {}

  async getPracticeQuality(
    query: PracticeQualityQueryDto = {},
  ): Promise<PracticeQualityResponseDto> {
    const needsFloor =
      (query.range ?? 'all') === 'all' && !query.from && !query.to;
    const window = resolveAnalyticsWindow(query, {
      defaultRange: 'all',
      defaultBucketFor,
      allTimeStart: needsFloor ? await this.repo.getDataFloor() : undefined,
    });
    const tenantId = query.tenantId?.trim() || undefined;
    const language = query.language?.trim() || undefined;
    const { start, endExclusive, bucket } = window;

    const rows = await withReportingQuerySlot(() =>
      this.repo.getPracticeQuality(start, endExclusive, bucket, {
        tenantId,
        language,
      }),
    );
    const built = buildPracticeQuality(
      rows,
      generateBucketLabels(start, endExclusive, bucket),
      MIN_SCORE_SAMPLE_SIZE,
    );

    return {
      window: describeWindow(window),
      language: language ?? null,
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      practiceThresholds: { ...PRACTICE_THRESHOLDS },
      ...built,
      provenance: {
        derivation:
          `R7 — transcript shape, deterministic (no judge). Per countable session: learner ` +
          `characters ÷ all characters (learner = every speaker but the AI client; the client's ` +
          `filler and holding utterances dropped), and learner turns (non-empty learner lines). ` +
          `A session counts as practice with at least ${PRACTICE_THRESHOLDS.minLearnerTurns} ` +
          `learner turns, ${PRACTICE_THRESHOLDS.minDurationMinutes} minutes net of pauses and ` +
          `${PRACTICE_THRESHOLDS.minLearnerChars} learner characters. Bucketed by session end; ` +
          `percentiles and shares withheld below ${MIN_SCORE_SAMPLE_SIZE} sessions; test ` +
          `organisations excluded.`,
        note:
          `Characters per word differ by script (a Devanagari or Tamil word is not a Latin ` +
          `word's length), so compare talk share within one language — use the language filter. ` +
          `A high share is the learner doing the work; it does not say the work was good.`,
      },
      // Sessions and their transcripts carry a tenant, so nothing here stays
      // platform-wide under the org filter.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }
}
