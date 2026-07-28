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

export function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
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
};

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
 */
export function resolveAnalyticsWindow(
  query: WindowQuery,
  opts: {
    defaultRange: AnalyticsRange;
    defaultBucketFor: (range: AnalyticsRange) => AnalyticsBucket;
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
    return {
      start,
      endExclusive,
      bucket: query.bucket ?? autoBucketForDays(days),
      days,
      label: `${isoDate(start)} → ${isoDate(toInclusive)}`,
      custom: true,
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
  } else {
    start = startOfUtcMonth(addMonths(todayStart, -11));
  }
  const days = Math.round(
    (endExclusive.getTime() - start.getTime()) / MS_PER_DAY,
  );

  return {
    start,
    endExclusive,
    bucket: query.bucket ?? opts.defaultBucketFor(range),
    days,
    label: RANGE_LABEL[range],
    custom: false,
  };
}

/**
 * The equal-length period ending where `window` begins — the comparison basis
 * for a KPI delta.
 *
 * Equal length matters: comparing a 30-day window against a calendar month, or
 * against a period of a different length, produces a delta that is an artefact
 * of the windowing rather than a change in the metric.
 */
export function previousWindow(window: AnalyticsWindow): {
  start: Date;
  endExclusive: Date;
  label: string;
} {
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

  let cur = startOfUtcWeekMonday(windowStart);
  const last = startOfUtcWeekMonday(lastDay);
  while (cur <= last) {
    labels.push(isoDate(cur));
    cur = addDays(cur, 7);
  }
  return labels;
}
