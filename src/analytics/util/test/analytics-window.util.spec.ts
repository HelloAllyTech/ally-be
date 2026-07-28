import { BadRequestException } from '@nestjs/common';

import {
  MAX_CUSTOM_RANGE_DAYS,
  generateBucketLabels,
  isoDate,
  previousWindow,
  resolveAnalyticsWindow,
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

const resolve = (query: Parameters<typeof resolveAnalyticsWindow>[0]) =>
  resolveAnalyticsWindow(query, {
    defaultRange: '30d',
    defaultBucketFor,
    now: NOW,
  });

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
