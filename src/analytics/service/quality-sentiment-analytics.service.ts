import { Injectable } from '@nestjs/common';

import { AnalyticsRange } from '../dto/platform-analytics.dto';
import {
  QualitySentimentPointDto,
  QualitySentimentQueryDto,
  QualitySentimentResponseDto,
} from '../dto/quality-sentiment-analytics.dto';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  MIN_SENTIMENT_RESPONSES,
  QualitySentimentAnalyticsRepository,
} from '../repository/quality-sentiment-analytics.repository';
import {
  describeWindow,
  generateBucketLabels,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';

const PROXY_NOTE =
  'Proxy NPS, not NPS. Ally has never asked the 0-10 "would you recommend" ' +
  'question; this is derived from the 1-5 post-session rating by treating 5 as ' +
  'a promoter, 4 as passive and 3 or below as a detractor. It is comparable ' +
  "with itself over time and with nobody else's published score.";

/**
 * Fewest paired buckets a correlation may be quoted for.
 *
 * Three. Two points always correlate perfectly at ±1, which would put a
 * meaningless "r = 1.00" on the card of any platform with two months of data —
 * the most confident-looking number on the page appearing exactly when there is
 * least reason to be confident.
 */
const MIN_PAIRED_BUCKETS = 3;

/**
 * Bucket granularity per range.
 *
 * Both series need a sample per bucket — a mean score and a top-box share are
 * both unstable over a handful of sessions — so this is deliberately coarser than
 * the growth charts. The reader can still ask for `day`.
 */
const defaultBucketFor = (range: AnalyticsRange): AnalyticsBucket =>
  range === '12m' || range === 'all' ? 'month' : 'week';

/**
 * Does the judge agree with the learner?
 *
 * The LLM-judge composite score and a proxy NPS on one axis, plus their
 * correlation. Divergence is the signal the card exists for: quality rising while
 * sentiment falls means the scenarios got harder, both falling means something
 * broke, and either number alone can be moved in the wrong direction without
 * anyone noticing.
 *
 * Four rules live here:
 *
 *  - **The proxy is labelled as a proxy, in the payload.** `proxyNote` is not
 *    decoration: a −100..+100 figure with no qualifier WILL be quoted as an NPS
 *    to someone outside the company, and it is not comparable with anyone else's.
 *  - **A proxy NPS below the response floor is null, not zero.** Over four
 *    responses one rating moves it by 25 points, so the figure would be noise
 *    presented as a trend — and it would also name a respondent.
 *  - **Neither series is gap-filled with zeros.** Both are means; a bucket with
 *    no data has no value, and drawing it at zero (or at −100) invents a
 *    catastrophe. The axis stays contiguous, the lines break.
 *  - **The correlation is computed over PAIRED buckets only,** and suppressed
 *    below three of them. Correlating a score series against a sentiment series
 *    with different holes in it would be correlating two different periods.
 */
@Injectable()
export class QualitySentimentAnalyticsService {
  constructor(private readonly repo: QualitySentimentAnalyticsRepository) {}

  async getQualitySentiment(
    query: QualitySentimentQueryDto,
  ): Promise<QualitySentimentResponseDto> {
    const needsFloor =
      (query.range ?? 'all') === 'all' && !query.from && !query.to;
    const window = resolveAnalyticsWindow(query, {
      defaultRange: 'all',
      defaultBucketFor,
      allTimeStart: needsFloor ? await this.repo.getDataFloor() : undefined,
    });
    const tenantId = query.tenantId?.trim() || undefined;
    const { start, endExclusive, bucket } = window;

    const rows = await this.repo.getByBucket(
      start,
      endExclusive,
      bucket,
      tenantId,
    );
    const byBucket = new Map(rows.map((r) => [r.bucket, r]));

    const points: QualitySentimentPointDto[] = generateBucketLabels(
      start,
      endExclusive,
      bucket,
    ).map((bucketKey) => {
      const row = byBucket.get(bucketKey);
      const responses = row?.responses ?? 0;
      return {
        bucket: bucketKey,
        avgCompositeScore: row?.avgCompositeScore ?? null,
        evaluatedSessions: row?.evaluatedSessions ?? 0,
        proxyNps: proxyNps(
          row?.promoters ?? 0,
          row?.detractors ?? 0,
          responses,
        ),
        avgRating: row?.avgRating ?? null,
        responses,
        promoters: row?.promoters ?? 0,
        passives: row?.passives ?? 0,
        detractors: row?.detractors ?? 0,
      };
    });

    // Whole-window figures from the RAW rows. The mean score is re-weighted by
    // each bucket's session count rather than averaging the bucket means, which
    // would weight a quiet week like a busy one; the proxy NPS is recomputed from
    // total promoters and detractors for the same reason.
    const totals = rows.reduce(
      (sum, r) => ({
        weightedScore:
          sum.weightedScore +
          (r.avgCompositeScore === null
            ? 0
            : r.avgCompositeScore * r.evaluatedSessions),
        evaluated:
          sum.evaluated +
          (r.avgCompositeScore === null ? 0 : r.evaluatedSessions),
        responses: sum.responses + r.responses,
        promoters: sum.promoters + r.promoters,
        detractors: sum.detractors + r.detractors,
      }),
      {
        weightedScore: 0,
        evaluated: 0,
        responses: 0,
        promoters: 0,
        detractors: 0,
      },
    );

    const paired = points.filter(
      (p) => p.avgCompositeScore !== null && p.proxyNps !== null,
    );

    return {
      range: window.custom ? '30d' : ((query.range ?? 'all') as AnalyticsRange),
      bucket,
      window: describeWindow(window),
      points,
      overallCompositeScore:
        totals.evaluated > 0
          ? Math.round((totals.weightedScore / totals.evaluated) * 10) / 10
          : null,
      overallProxyNps: proxyNps(
        totals.promoters,
        totals.detractors,
        totals.responses,
      ),
      totalEvaluatedSessions: totals.evaluated,
      totalResponses: totals.responses,
      minResponses: MIN_SENTIMENT_RESPONSES,
      correlation:
        paired.length >= MIN_PAIRED_BUCKETS
          ? pearson(
              paired.map((p) => p.avgCompositeScore as number),
              paired.map((p) => p.proxyNps as number),
            )
          : null,
      pairedBuckets: paired.length,
      proxyNote: PROXY_NOTE,
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }
}

/**
 * %promoters − %detractors, on the NPS −100..+100 scale.
 *
 * Null below the response floor — see the class doc: over a handful of responses
 * a single rating moves this by tens of points, so the figure would be noise
 * wearing the clothes of a metric, and it would also identify a respondent.
 */
function proxyNps(
  promoters: number,
  detractors: number,
  responses: number,
): number | null {
  if (responses < MIN_SENTIMENT_RESPONSES) return null;
  return Math.round(((promoters - detractors) / responses) * 1000) / 10;
}

/**
 * Pearson r over paired series.
 *
 * Returns null when either series has no variance — a flat month of identical
 * scores makes the denominator zero, and reporting that as 0 ("no relationship")
 * or 1 ("perfect") would both be inventions.
 */
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n === 0 || ys.length !== n) return null;

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }

  if (varianceX === 0 || varianceY === 0) return null;
  return (
    Math.round((covariance / Math.sqrt(varianceX * varianceY)) * 1000) / 1000
  );
}
