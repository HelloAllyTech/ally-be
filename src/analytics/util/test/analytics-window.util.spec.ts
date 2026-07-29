import { BadRequestException } from '@nestjs/common';

import {
  MAX_CUSTOM_RANGE_DAYS,
  describeWindow,
  generateBucketLabels,
  isoDate,
  previousWindow,
  resolveAnalyticsWindow,
  truncToBucket,
} from '../analytics-window.util';
import { AnalyticsRange } from '../../dto/platform-analytics.dto';
import { AnalyticsBucket } from '../../repository/platform-analytics.repository';

/** Wednesday 2024-06-12T12:00:00Z — the anchor the sibling service specs use. */
const NOW = new Date('2024-06-12T12:00:00.000Z');

/** The highlights bucket defaults (30d -> day), for the preset cases. */
const defaultBucketFor = (range: AnalyticsRange): AnalyticsBucket => {
  if (range === '30d') return 'day';
  if (range === '90d') return 'week';
  return 'month';
};

const resolve = (
  query: Parameters<typeof resolveAnalyticsWindow>[0],
  allTimeStart?: Date,
) =>
  resolveAnalyticsWindow(query, {
    defaultRange: '30d',
    defaultBucketFor,
    allTimeStart,
    now: NOW,
  });

/** A plausible platform data floor for the all-time cases. */
const FLOOR = new Date('2022-11-03T09:41:00.000Z');

describe('resolveAnalyticsWindow', () => {
  describe('rolling presets', () => {
    it('30d spans today plus the 29 preceding days, in day buckets', () => {
      const w = resolve({ range: '30d' });

      expect(isoDate(w.start)).toBe('2024-05-14');
      // Exclusive bound is start of tomorrow, so all of today counts.
      expect(isoDate(w.endExclusive)).toBe('2024-06-13');
      expect(w.days).toBe(30);
      expect(w.bucket).toBe('day');
      expect(w.label).toBe('Last 30 days');
      expect(w.custom).toBe(false);
    });

    it('90d spans 90 days in week buckets', () => {
      const w = resolve({ range: '90d' });

      expect(isoDate(w.start)).toBe('2024-03-15');
      expect(w.days).toBe(90);
      expect(w.bucket).toBe('week');
    });

    it('12m starts at the first of the month 11 months back', () => {
      const w = resolve({ range: '12m' });

      expect(isoDate(w.start)).toBe('2023-07-01');
      expect(w.bucket).toBe('month');
    });

    it('defaults the range when none is given', () => {
      expect(resolve({}).label).toBe('Last 30 days');
    });

    it('honours an explicit bucket override', () => {
      expect(resolve({ range: '30d', bucket: 'week' }).bucket).toBe('week');
    });
  });

  describe('custom from/to windows', () => {
    it('treats `to` as INCLUSIVE and converts to an exclusive bound', () => {
      const w = resolve({ from: '2024-01-01', to: '2024-01-31' });

      expect(isoDate(w.start)).toBe('2024-01-01');
      expect(isoDate(w.endExclusive)).toBe('2024-02-01');
      expect(w.days).toBe(31);
      expect(w.label).toBe('2024-01-01 → 2024-01-31');
      expect(w.custom).toBe(true);
    });

    it('accepts a single-day window', () => {
      const w = resolve({ from: '2024-01-05', to: '2024-01-05' });

      expect(w.days).toBe(1);
      expect(isoDate(w.endExclusive)).toBe('2024-01-06');
    });

    it('auto-buckets by span: day <= 31, week <= 120, month beyond', () => {
      expect(resolve({ from: '2024-01-01', to: '2024-01-31' }).bucket).toBe(
        'day',
      );
      expect(resolve({ from: '2024-01-01', to: '2024-03-01' }).bucket).toBe(
        'week',
      );
      expect(resolve({ from: '2024-01-01', to: '2024-12-01' }).bucket).toBe(
        'month',
      );
    });

    it('lets an explicit bucket beat the auto choice', () => {
      expect(
        resolve({ from: '2024-01-01', to: '2024-12-01', bucket: 'week' })
          .bucket,
      ).toBe('week');
    });

    it('ignores `range` when a custom window is supplied', () => {
      const w = resolve({ range: '12m', from: '2024-01-01', to: '2024-01-10' });

      expect(isoDate(w.start)).toBe('2024-01-01');
      expect(w.custom).toBe(true);
    });

    it.each([
      ['from without to', { from: '2024-01-01' }],
      ['to without from', { to: '2024-01-31' }],
    ])('rejects %s', (_label, query) => {
      expect(() => resolve(query)).toThrow(BadRequestException);
      expect(() => resolve(query)).toThrow(/must be supplied together/);
    });

    it('rejects an inverted range', () => {
      expect(() => resolve({ from: '2024-02-01', to: '2024-01-01' })).toThrow(
        /on or after/,
      );
    });

    it('rejects a non-ISO date', () => {
      expect(() => resolve({ from: '01/02/2024', to: '2024-01-31' })).toThrow(
        /ISO date/,
      );
    });

    it(`rejects a span over ${MAX_CUSTOM_RANGE_DAYS} days`, () => {
      expect(() => resolve({ from: '2020-01-01', to: '2024-01-01' })).toThrow(
        new RegExp(`limited to ${MAX_CUSTOM_RANGE_DAYS} days`),
      );
    });
  });

  describe("range='all'", () => {
    it('runs from the supplied data floor to today, in month buckets', () => {
      const w = resolve({ range: 'all' }, FLOOR);

      // Truncated to the UTC day: the floor is a timestamp, the axis is dates.
      expect(isoDate(w.start)).toBe('2022-11-03');
      expect(isoDate(w.endExclusive)).toBe('2024-06-13');
      expect(w.label).toBe('All time');
      expect(w.bucket).toBe('month');
      expect(w.allTime).toBe(true);
      expect(w.custom).toBe(false);
    });

    it('is not capped by the custom-range limit', () => {
      // MAX_CUSTOM_RANGE_DAYS guards an arbitrary from/to scan; all-time is a
      // deliberate whole-history read and spans further than that by design.
      expect(resolve({ range: 'all' }, FLOOR).days).toBeGreaterThan(
        MAX_CUSTOM_RANGE_DAYS,
      );
    });

    it('honours an explicit bucket, including year', () => {
      expect(resolve({ range: 'all', bucket: 'year' }, FLOOR).bucket).toBe(
        'year',
      );
      expect(resolve({ range: 'all', bucket: 'day' }, FLOOR).bucket).toBe(
        'day',
      );
    });

    it('rejects the range when the caller supplied no data floor', () => {
      // The alternatives — today, or a guessed epoch — both return a window
      // that looks resolved and covers the wrong period.
      expect(() => resolve({ range: 'all' })).toThrow(BadRequestException);
      expect(() => resolve({ range: 'all' })).toThrow(/not supported/);
    });

    it('clamps a floor in the future to today rather than inverting the window', () => {
      const w = resolve({ range: 'all' }, new Date('2030-01-01T00:00:00.000Z'));

      expect(isoDate(w.start)).toBe('2024-06-12');
      expect(w.endExclusive.getTime()).toBeGreaterThan(w.start.getTime());
    });

    it('lets from/to win over range=all without needing a floor', () => {
      const w = resolve({ range: 'all', from: '2024-01-01', to: '2024-01-31' });

      expect(w.custom).toBe(true);
      expect(w.allTime).toBe(false);
    });
  });

  describe('inProgressBucket', () => {
    it("names the bucket containing today, at the window's grain", () => {
      expect(resolve({ range: '30d' }).inProgressBucket).toBe('2024-06-12');
      expect(resolve({ range: '90d' }).inProgressBucket).toBe('2024-06-10');
      expect(resolve({ range: '12m' }).inProgressBucket).toBe('2024-06-01');
      expect(
        resolve({ range: 'all', bucket: 'year' }, FLOOR).inProgressBucket,
      ).toBe('2024-01-01');
    });

    it('is null for a custom window that ended in the past', () => {
      expect(
        resolve({ from: '2024-01-01', to: '2024-01-31' }).inProgressBucket,
      ).toBeNull();
    });

    it('is set for a custom window that runs up to today', () => {
      expect(
        resolve({ from: '2024-06-01', to: '2024-06-12' }).inProgressBucket,
      ).toBe('2024-06-12');
    });
  });
});

describe('describeWindow', () => {
  it('reports `to` inclusive and carries the all-time / in-progress flags', () => {
    const at = new Date('2024-06-12T15:00:00.000Z');
    const described = describeWindow(resolve({ range: 'all' }, FLOOR), at);

    expect(described).toEqual({
      from: '2022-11-03',
      // Inclusive: the exclusive bound is 2024-06-13.
      to: '2024-06-12',
      label: 'All time',
      days: 588,
      bucket: 'month',
      allTime: true,
      inProgressBucket: '2024-06-01',
      computedAt: at.toISOString(),
    });
  });
});

describe('truncToBucket', () => {
  const d = (s: string) => new Date(`${s}T13:45:00.000Z`);

  it('matches what Postgres date_trunc would produce for each grain', () => {
    // 2024-05-15 is a Wednesday.
    expect(isoDate(truncToBucket(d('2024-05-15'), 'day'))).toBe('2024-05-15');
    expect(isoDate(truncToBucket(d('2024-05-15'), 'week'))).toBe('2024-05-13');
    expect(isoDate(truncToBucket(d('2024-05-15'), 'month'))).toBe('2024-05-01');
    expect(isoDate(truncToBucket(d('2024-05-15'), 'year'))).toBe('2024-01-01');
  });
});

describe('previousWindow', () => {
  it('is the equal-length period ending where the current window begins', () => {
    const prev = previousWindow(resolve({ range: '30d' }));

    // Current is [2024-05-14, 2024-06-13); previous must be the 30 days before.
    expect(isoDate(prev.start)).toBe('2024-04-14');
    expect(isoDate(prev.endExclusive)).toBe('2024-05-14');
    expect(prev.label).toBe('previous 30 days');
  });

  it('abuts the current window exactly — no gap, no overlap', () => {
    const current = resolve({ range: '90d' });
    const prev = previousWindow(current);

    expect(prev.endExclusive.getTime()).toBe(current.start.getTime());
    const prevDays =
      (prev.endExclusive.getTime() - prev.start.getTime()) / 86_400_000;
    expect(prevDays).toBe(current.days);
  });

  it('refuses an all-time window instead of comparing against empty history', () => {
    // There is nothing before the platform's first row, so a "previous period"
    // is guaranteed empty and every delta against it would read as growth from
    // zero. Callers must return no comparison at all.
    expect(() => previousWindow(resolve({ range: 'all' }, FLOOR))).toThrow(
      /no comparison basis/,
    );
  });

  it('matches the length of a custom window rather than a calendar month', () => {
    // February 2024 is 29 days, so the comparison basis must also be 29 days —
    // comparing against a 31-day January would make the delta an artefact of
    // the windowing rather than a change in the metric.
    const current = resolve({ from: '2024-02-01', to: '2024-02-29' });
    const prev = previousWindow(current);

    expect(current.days).toBe(29);
    // 29 days back from 2024-02-01 is 2024-01-03, NOT 2024-01-01 — the basis is
    // an equal-length period, not the preceding calendar month.
    expect(isoDate(prev.start)).toBe('2024-01-03');
    expect(isoDate(prev.endExclusive)).toBe('2024-02-01');
  });
});

describe('generateBucketLabels', () => {
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

  it('emits one label per day, inclusive of the first, exclusive of the bound', () => {
    const labels = generateBucketLabels(
      d('2024-05-14'),
      d('2024-05-17'),
      'day',
    );

    expect(labels).toEqual(['2024-05-14', '2024-05-15', '2024-05-16']);
  });

  it('emits ISO week starts (Mondays) covering the window', () => {
    // 2024-05-14 is a Tuesday, so the first bucket starts Monday 05-13.
    const labels = generateBucketLabels(
      d('2024-05-14'),
      d('2024-06-13'),
      'week',
    );

    expect(labels).toEqual([
      '2024-05-13',
      '2024-05-20',
      '2024-05-27',
      '2024-06-03',
      '2024-06-10',
    ]);
  });

  it('emits month starts covering the window', () => {
    const labels = generateBucketLabels(
      d('2023-07-01'),
      d('2023-10-05'),
      'month',
    );

    expect(labels).toEqual([
      '2023-07-01',
      '2023-08-01',
      '2023-09-01',
      '2023-10-01',
    ]);
  });

  it('emits year starts covering the window', () => {
    const labels = generateBucketLabels(
      d('2022-11-03'),
      d('2024-06-13'),
      'year',
    );

    expect(labels).toEqual(['2022-01-01', '2023-01-01', '2024-01-01']);
  });

  it('emits a single label for a one-day window', () => {
    expect(
      generateBucketLabels(d('2024-05-14'), d('2024-05-15'), 'day'),
    ).toEqual(['2024-05-14']);
  });

  it('emits nothing for an empty window', () => {
    expect(
      generateBucketLabels(d('2024-05-14'), d('2024-05-14'), 'day'),
    ).toEqual([]);
  });
});
