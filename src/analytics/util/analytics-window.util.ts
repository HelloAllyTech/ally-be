import { BadRequestException } from '@nestjs/common';

import {
  AnalyticsBucketParam,
  AnalyticsRange,
} from '../dto/platform-analytics.dto';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';

/**
 * The single answer to "which window am I querying, and in what buckets?" for
 * super-admin analytics.
 *
 * This replaces the private copies of the same UTC date maths and range→bucket
 * mapping that had accreted in four sibling service files, and adds two things
 * those copies could not express:
 *
 *  - an explicit `from`/`to` window, so an analyst can ask about a specific
 *    period rather than only the three rolling presets;
 *  - {@link previousWindow}, the equal-length period immediately before, which
 *    is what makes a KPI delta meaningful. A bare "+12%" says nothing without
 *    "vs. the previous 30 days" attached, and the comparison basis has to be
 *    computed from the same window length or the comparison is a lie.
 *
 * All bucketing is UTC. `date_trunc` on the tz-naive `timestamp` columns is pure
 * calendar math, so the repositories' `yyyy-mm-dd` keys line up with a
 * UTC-generated axis regardless of the Node timezone.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Guard on custom ranges. Wide enough for "two years of monthly buckets",
 * narrow enough that one request cannot scan the whole table history.
 */
export const MAX_CUSTOM_RANGE_DAYS = 400;

export function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_DAY);
}

export function addMonths(d: Date, n: number): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()),
  );
}

export function addYears(d: Date, n: number): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), d.getUTCDate()),
  );
}

export function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function startOfUtcYear(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
}

/** ISO week start (Monday 00:00 UTC), matching Postgres `date_trunc('week')`. */
export function startOfUtcWeekMonday(d: Date): Date {
  const day = startOfUtcDay(d);
  const dow = day.getUTCDay(); // 0=Sun .. 6=Sat
  const offset = (dow + 6) % 7; // days since Monday
  return addDays(day, -offset);
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Truncate a date to the start of the bucket that contains it — the JS twin of
 * Postgres `date_trunc`, so a value bucketed in SQL and a value bucketed here
 * produce the same `yyyy-mm-dd` key. Used wherever a row's own timestamp has to
 * be compared against the bucket it landed in (new-vs-returning labelling).
 */
export function truncToBucket(d: Date, bucket: AnalyticsBucket): Date {
  if (bucket === 'day') return startOfUtcDay(d);
  if (bucket === 'week') return startOfUtcWeekMonday(d);
  if (bucket === 'month') return startOfUtcMonth(d);
  return startOfUtcYear(d);
}

/** A resolved query window plus the bucket granularity to aggregate it by. */
export interface AnalyticsWindow {
  /** Inclusive lower bound (UTC day start). */
  start: Date;
  /** Exclusive upper bound (UTC day start). */
  endExclusive: Date;
  bucket: AnalyticsBucket;
  /** Whole days spanned — drives {@link previousWindow}. */
  days: number;
  /**
   * Human-readable window, echoed to the client so every chart and export can
   * state the period it covers on its face.
   */
  label: string;
  /** True when the window came from explicit `from`/`to` rather than a preset. */
  custom: boolean;
  /**
   * True for `range=all`: the window runs from the platform's first row to
   * today.
   *
   * Callers must not ask {@link previousWindow} for a comparison basis on an
   * all-time window. "The equal-length period before all of history" contains no
   * data by construction, so every delta computed against it would read as
   * growth from zero — which is an artefact of the windowing, not a change in
   * the metric.
   */
  allTime: boolean;
  /**
   * Start of the bucket that contains today (`yyyy-mm-dd`), or null when the
   * window ended in the past.
   *
   * This bucket is STILL ACCRUING: its figure can only rise, so it is not
   * comparable with the completed buckets beside it. Surfaces show it in tables
   * (flagged) and leave it off line and bar charts — there is no way to draw
   * "not finished yet", so an unfinished period renders as a fall the reader
   * explains to themselves. Named here rather than re-derived per client so
   * every surface flags the same bucket.
   */
  inProgressBucket: string | null;
}

export interface WindowQuery {
  range?: AnalyticsRange;
  bucket?: AnalyticsBucketParam;
  from?: string;
  to?: string;
}

const RANGE_LABEL: Record<AnalyticsRange, string> = {
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '12m': 'Last 12 months',
  all: 'All time',
};

/**
 * Bucket an all-time window defaults to.
 *
 * Month rather than the range-derived default: an all-time window is years
 * wide, and a daily axis over it is a thousand ticks nobody can read. The
 * granularity is a per-chart choice from there — see the `bucket` param.
 */
const ALL_TIME_DEFAULT_BUCKET: AnalyticsBucket = 'month';

/** Bucket that keeps a custom window to a readable number of points. */
function autoBucketForDays(days: number): AnalyticsBucket {
  if (days <= 31) return 'day';
  if (days <= 120) return 'week';
  return 'month';
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value: string, field: string): Date {
  if (!ISO_DATE.test(value)) {
    throw new BadRequestException(
      `${field} must be an ISO date (yyyy-mm-dd), got "${value}"`,
    );
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} is not a valid date: "${value}"`);
  }
  return parsed;
}

/**
 * Resolve a query into a concrete window.
 *
 * `from`/`to` win when both are present; otherwise the `range` preset is used,
 * anchored on today. `to` is inclusive for the caller (a human asking for
 * "1 Jan to 31 Mar" means all of 31 Mar) and converted to an exclusive bound
 * here, which is the only form the repositories accept.
 *
 * `defaultBucketFor` stays a caller concern because the endpoints legitimately
 * differ — highlights buckets 30d by day, the platform overview by week. Passing
 * it in preserves each endpoint's existing granularity rather than silently
 * re-bucketing live charts.
 *
 * `range=all` needs `allTimeStart` — the platform's first row, which only the
 * database knows. Callers fetch it (see `getPlatformDataFloor`) and pass it in;
 * without it an all-time window would have to guess an epoch, and a chart whose
 * axis starts at a guessed date is a chart with an invented history. When the
 * platform has no rows at all the floor collapses to today, which is the honest
 * answer: the window is empty because there is nothing in it.
 */
export function resolveAnalyticsWindow(
  query: WindowQuery,
  opts: {
    defaultRange: AnalyticsRange;
    defaultBucketFor: (range: AnalyticsRange) => AnalyticsBucket;
    /** Required when the resolved range is 'all'. */
    allTimeStart?: Date;
    now?: Date;
  },
): AnalyticsWindow {
  const now = opts.now ?? new Date();
  const todayStart = startOfUtcDay(now);

  if (query.from || query.to) {
    if (!query.from || !query.to) {
      throw new BadRequestException(
        'from and to must be supplied together for a custom range',
      );
    }
    const start = parseIsoDate(query.from, 'from');
    const toInclusive = parseIsoDate(query.to, 'to');
    if (toInclusive < start) {
      throw new BadRequestException('to must be on or after from');
    }
    // Exclusive upper bound = start of the day after `to`, so all of `to` counts.
    const endExclusive = addDays(toInclusive, 1);
    const days = Math.round(
      (endExclusive.getTime() - start.getTime()) / MS_PER_DAY,
    );
    if (days > MAX_CUSTOM_RANGE_DAYS) {
      throw new BadRequestException(
        `Custom range is limited to ${MAX_CUSTOM_RANGE_DAYS} days, got ${days}`,
      );
    }
    const bucket = query.bucket ?? autoBucketForDays(days);
    return {
      start,
      endExclusive,
      bucket,
      days,
      label: `${isoDate(start)} → ${isoDate(toInclusive)}`,
      custom: true,
      allTime: false,
      // A custom window that stops short of today has no in-progress bucket;
      // one that runs up to (or past) today does.
      inProgressBucket:
        endExclusive > todayStart
          ? isoDate(truncToBucket(todayStart, bucket))
          : null,
    };
  }

  const range = query.range ?? opts.defaultRange;
  // Exclusive upper bound = start of tomorrow, so all of today is included.
  const endExclusive = addDays(todayStart, 1);
  let start: Date;
  if (range === '30d') {
    start = addDays(todayStart, -29);
  } else if (range === '90d') {
    start = addDays(todayStart, -89);
  } else if (range === '12m') {
    start = startOfUtcMonth(addMonths(todayStart, -11));
  } else {
    // All time: the platform's first row. An endpoint that has not measured its
    // data floor cannot answer this range — rejecting it is the only honest
    // option, because the fallbacks (today, or a guessed epoch) would both
    // return a window that looks resolved and covers the wrong period.
    if (!opts.allTimeStart) {
      throw new BadRequestException(
        'range=all is not supported by this endpoint',
      );
    }
    start = startOfUtcDay(
      opts.allTimeStart > todayStart ? todayStart : opts.allTimeStart,
    );
  }
  const days = Math.round(
    (endExclusive.getTime() - start.getTime()) / MS_PER_DAY,
  );
  const bucket =
    query.bucket ??
    (range === 'all' ? ALL_TIME_DEFAULT_BUCKET : opts.defaultBucketFor(range));

  return {
    start,
    endExclusive,
    bucket,
    days,
    label: RANGE_LABEL[range],
    custom: false,
    allTime: range === 'all',
    inProgressBucket: isoDate(truncToBucket(todayStart, bucket)),
  };
}

/**
 * The resolved window as the clients see it — one builder so every endpoint
 * echoes the same shape.
 *
 * `to` is reported INCLUSIVE, which is how a reader reads a date range; the
 * repositories only ever see the exclusive bound. This used to be an object
 * literal repeated in each endpoint, which is how a field could be added to the
 * contract and reach only some of them.
 */
export function describeWindow(
  window: AnalyticsWindow,
  now = new Date(),
): {
  from: string;
  to: string;
  label: string;
  days: number;
  bucket: AnalyticsBucket;
  allTime: boolean;
  inProgressBucket: string | null;
  computedAt: string;
} {
  return {
    from: isoDate(window.start),
    to: isoDate(addDays(window.endExclusive, -1)),
    label: window.label,
    days: window.days,
    bucket: window.bucket,
    allTime: window.allTime,
    inProgressBucket: window.inProgressBucket,
    computedAt: now.toISOString(),
  };
}

/**
 * The equal-length period ending where `window` begins — the comparison basis
 * for a KPI delta.
 *
 * Equal length matters: comparing a 30-day window against a calendar month, or
 * against a period of a different length, produces a delta that is an artefact
 * of the windowing rather than a change in the metric.
 *
 * Throws for an all-time window: there is nothing before the platform's first
 * row, so the "previous period" is guaranteed empty and every delta against it
 * would report growth from zero. Callers must return no comparison at all
 * instead — a KPI with no basis shows its bare value, which is honest, where a
 * KPI with a fabricated basis is not.
 */
export function previousWindow(window: AnalyticsWindow): {
  start: Date;
  endExclusive: Date;
  label: string;
} {
  if (window.allTime) {
    throw new Error(
      'previousWindow: an all-time window has no comparison basis — ' +
        'return { previous: null } instead of comparing against empty history',
    );
  }
  const endExclusive = window.start;
  const start = addDays(window.start, -window.days);
  return {
    start,
    endExclusive,
    label: `previous ${window.days} days`,
  };
}

/**
 * Contiguous bucket-start labels (yyyy-mm-dd) spanning the window, so charts get
 * a gap-free axis even where a bucket has no rows.
 *
 * Note what this is and is not for: it gives COUNT and SUM series a real zero for
 * an empty bucket ("nobody practised that week" is a fact). It must never be
 * used to gap-fill an AVERAGE — the mean of no observations is not zero, and
 * plotting it as zero fabricates a measurement.
 */
export function generateBucketLabels(
  windowStart: Date,
  endExclusive: Date,
  bucket: AnalyticsBucket,
): string[] {
  const lastDay = addDays(endExclusive, -1);
  const labels: string[] = [];

  if (bucket === 'day') {
    for (let cur = windowStart; cur < endExclusive; cur = addDays(cur, 1)) {
      labels.push(isoDate(cur));
    }
    return labels;
  }

  if (bucket === 'month') {
    let cur = startOfUtcMonth(windowStart);
    const last = startOfUtcMonth(lastDay);
    while (cur <= last) {
      labels.push(isoDate(cur));
      cur = addMonths(cur, 1);
    }
    return labels;
  }

  if (bucket === 'year') {
    let cur = startOfUtcYear(windowStart);
    const last = startOfUtcYear(lastDay);
    while (cur <= last) {
      labels.push(isoDate(cur));
      cur = addYears(cur, 1);
    }
    return labels;
  }

  let cur = startOfUtcWeekMonday(windowStart);
  const last = startOfUtcWeekMonday(lastDay);
  while (cur <= last) {
    labels.push(isoDate(cur));
    cur = addDays(cur, 7);
  }
  return labels;
}
