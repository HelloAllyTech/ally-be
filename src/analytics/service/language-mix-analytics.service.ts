import { Injectable } from '@nestjs/common';

import {
  LANGUAGE_MIX_OTHER_LABEL,
  LANGUAGE_MIX_UNKNOWN_LABEL,
  LanguageMixAnalyticsRepository,
  LanguageMixBucketRow,
  MAX_LANGUAGE_SERIES,
} from '../repository/language-mix-analytics.repository';
import {
  LanguageMixBucketTotalDto,
  LanguageMixPointDto,
  LanguageMixQueryDto,
  LanguageMixResponseDto,
} from '../dto/language-mix-analytics.dto';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  describeWindow,
  generateBucketLabels,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';

/**
 * All of history by default: a language mix moves over quarters, as voices ship and
 * new regions onboard, and the whole point of the chart is the shape of that drift.
 */
const DEFAULT_RANGE: AnalyticsRange = 'all';

/**
 * Monthly buckets by default, for every range rather than a per-range ladder.
 *
 * A mix is a composition, and a composition needs a denominator worth dividing: one
 * learner choosing Tamil moves a daily bar by twenty points, and a stacked chart
 * renders that noise as a trend the eye believes. A coarse default is the
 * conservative one — a client that knows its volume can ask for `bucket=day`.
 */
const DEFAULT_BUCKET: AnalyticsBucket = 'month';

/**
 * Language mix for the leadership surface.
 *
 * The repository returns every (bucket, language) cell; this service decides what a
 * chart may draw. The rules are data-visualisation house rules, and every one of
 * them exists because the client is the wrong place to apply it:
 *
 *  - **The palette has a ceiling, and the server enforces it.** At most
 *    {@link MAX_LANGUAGE_SERIES} labels come back, with the tail pooled into
 *    "Other". Left to the client, one surface would draw a ninth colour and another
 *    would drop the tail and understate its own totals.
 *  - **Missing data is its own category.** Sessions with no resolvable language are
 *    "Unknown" — never folded into "Other" and never dropped, so a growing
 *    measurement gap is visible instead of hiding inside a real band.
 *  - **The residual categories come last.** "Other" and "Unknown" are pushed to the
 *    end of the stacking order so the eye reads the real languages first, and so the
 *    tail always sits in the same place across buckets.
 *  - **One ranking for the whole window.** Series are ordered by their window total,
 *    not per bucket: a legend that reorders itself between buckets makes a stacked
 *    chart impossible to follow.
 *  - **The hidden denominator travels with the shares.** `bucketTotals` is dense and
 *    zero-filled (a count of sessions, so zero is a measurement), which is what lets
 *    a client refuse to draw a 100% bar over four sessions.
 */
@Injectable()
export class LanguageMixAnalyticsService {
  constructor(private readonly repository: LanguageMixAnalyticsRepository) {}

  async getLanguageMix(
    query: LanguageMixQueryDto,
  ): Promise<LanguageMixResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;

    const range = query.range ?? DEFAULT_RANGE;
    // The data floor is one extra cheap query, and only for an all-time range. An
    // endpoint that has not measured its floor must let the window util reject
    // `range=all` rather than guess an epoch and put an invented history on the
    // left of the axis; here it is measured, so the range is supported.
    const isAllTime = range === 'all' && !query.from && !query.to;
    const window = resolveAnalyticsWindow(
      { range, bucket: query.bucket, from: query.from, to: query.to },
      {
        defaultRange: DEFAULT_RANGE,
        defaultBucketFor: () => DEFAULT_BUCKET,
        allTimeStart: isAllTime
          ? await this.repository.getDataFloor()
          : undefined,
      },
    );

    const rows = await this.repository.getSessionsByBucketAndLanguage(
      window.start,
      window.endExclusive,
      window.bucket,
      tenantId,
    );

    const { labels, namedLanguages, distinctLanguages, unknownSessions } =
      this.resolveSeries(rows);

    return {
      window: describeWindow(window),
      labels,
      points: this.buildPoints(rows, labels, namedLanguages),
      bucketTotals: this.buildBucketTotals(rows, window),
      summary: {
        totalSessions: rows.reduce((a, r) => a + r.sessions, 0),
        distinctLanguages,
        unknownSessions,
      },
      maxSeries: MAX_LANGUAGE_SERIES,
      // Sessions carry a tenant, so there is nothing here that has to stay
      // platform-wide under a tenant filter.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Decide which languages get their own colour.
   *
   * Ranked by window total, descending, with the label as a tie-break so the order
   * is stable across requests — two languages on equal volume swapping places
   * between refreshes reads as data changing when nothing did.
   *
   * The slot arithmetic keeps the response inside the colour ceiling in every case,
   * which is the ceiling's whole purpose:
   *  - "Unknown" reserves a slot when it is present, because it is not poolable.
   *  - "Other" only appears when there is genuinely a tail. With exactly enough
   *    languages to fill the remaining slots, all of them stay NAMED — pooling one
   *    language into "Other" saves no colour and loses its name for nothing.
   */
  private resolveSeries(rows: LanguageMixBucketRow[]): {
    labels: string[];
    namedLanguages: Set<string>;
    distinctLanguages: number;
    unknownSessions: number;
  } {
    const totals = new Map<string, number>();
    for (const r of rows) {
      totals.set(r.label, (totals.get(r.label) ?? 0) + r.sessions);
    }

    const unknownSessions = totals.get(LANGUAGE_MIX_UNKNOWN_LABEL) ?? 0;
    const ranked = [...totals.entries()]
      .filter(([label]) => label !== LANGUAGE_MIX_UNKNOWN_LABEL)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label]) => label);

    const capacity = MAX_LANGUAGE_SERIES - (unknownSessions > 0 ? 1 : 0);
    const named =
      ranked.length <= capacity
        ? ranked
        : ranked.slice(0, Math.max(0, capacity - 1));

    const labels = [...named];
    if (named.length < ranked.length) labels.push(LANGUAGE_MIX_OTHER_LABEL);
    // Always last: the residual that means "we could not tell" belongs at the end
    // of the stack, whatever its size.
    if (unknownSessions > 0) labels.push(LANGUAGE_MIX_UNKNOWN_LABEL);

    return {
      labels,
      namedLanguages: new Set(named),
      // The true count, before pooling — otherwise the trimming would erase the
      // fact that there are more languages than series.
      distinctLanguages: ranked.length,
      unknownSessions,
    };
  }

  /**
   * Long-form cells, with the pooled tail summed per bucket.
   *
   * Pooling happens per bucket rather than once over the window, so "Other" is a
   * real band that rises and falls with its constituents instead of a constant
   * smear. Empty cells are omitted: a zero-height band says nothing and would
   * multiply the payload by the series count.
   */
  private buildPoints(
    rows: LanguageMixBucketRow[],
    labels: string[],
    namedLanguages: Set<string>,
  ): LanguageMixPointDto[] {
    const byBucket = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const label =
        namedLanguages.has(r.label) || r.label === LANGUAGE_MIX_UNKNOWN_LABEL
          ? r.label
          : LANGUAGE_MIX_OTHER_LABEL;
      const cells = byBucket.get(r.bucket) ?? new Map<string, number>();
      cells.set(label, (cells.get(label) ?? 0) + r.sessions);
      byBucket.set(r.bucket, cells);
    }

    const points: LanguageMixPointDto[] = [];
    for (const bucket of [...byBucket.keys()].sort()) {
      const cells = byBucket.get(bucket) ?? new Map<string, number>();
      // Emitted in the response's label order, so a client that appends rows in
      // arrival order still stacks them the way the legend reads.
      for (const label of labels) {
        const sessions = cells.get(label) ?? 0;
        if (sessions > 0) points.push({ bucket, label, sessions });
      }
    }
    return points;
  }

  /**
   * The denominator, on a contiguous axis.
   *
   * Zero-filled, unlike `points`: this series is what makes the x-axis a real
   * calendar, and these are counts — "nothing was completed that month" is a fact
   * about the month, not a missing measurement.
   */
  private buildBucketTotals(
    rows: LanguageMixBucketRow[],
    window: { start: Date; endExclusive: Date; bucket: AnalyticsBucket },
  ): LanguageMixBucketTotalDto[] {
    const totals = new Map<string, number>();
    for (const r of rows) {
      totals.set(r.bucket, (totals.get(r.bucket) ?? 0) + r.sessions);
    }

    return generateBucketLabels(
      window.start,
      window.endExclusive,
      window.bucket,
    ).map((bucket) => ({ bucket, sessions: totals.get(bucket) ?? 0 }));
  }
}
