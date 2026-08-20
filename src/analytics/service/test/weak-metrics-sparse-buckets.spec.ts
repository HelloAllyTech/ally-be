import { WeakMetricsAnalyticsService } from '../weak-metrics-analytics.service';
import { WEAK_METRICS_PARAMS } from '../../repository/weak-metrics-analytics.repository';

/**
 * Traffic per language is lumpy, and this tab buckets by week. Tamil ran 97 real
 * sessions in the week of 2026-05-25 and 2 in the week of 07-06, and both weeks
 * were drawn with the same weight — then the delta arrow read the last bucket
 * and reported "worsening" off a handful of turns. The card led with its least
 * reliable point.
 *
 * The guard flags rather than deletes: the bucket is real and belongs in the
 * expanded view's table. What it must not do is carry the plot or the headline.
 */
describe('WeakMetricsAnalyticsService — sparse buckets', () => {
  const service = new WeakMetricsAnalyticsService({} as never, {} as never);

  const min = WEAK_METRICS_PARAMS.minBucketDenominator;

  const build = (
    rows: { bucket: string; numerator: number; denominator: number }[],
  ) =>
    (
      service as never as {
        series: (
          id: string,
          label: string,
          unit: string,
          state: string,
          rows: unknown,
          opts?: unknown,
        ) => {
          points: { bucket: string; sparse: boolean; value: number | null }[];
          latest: number | null;
          previous: number | null;
        };
      }
    ).series('m', 'Metric', 'percent', 'measured', rows);

  it('flags a bucket under the minimum denominator', () => {
    const out = build([
      { bucket: '2026-07-27', numerator: 80, denominator: 800 },
      { bucket: '2026-08-03', numerator: 5, denominator: min - 1 },
    ]);

    expect(out.points.map((p) => p.sparse)).toEqual([false, true]);
  });

  it('keeps a bucket exactly at the minimum', () => {
    // A threshold that excluded its own boundary would quietly raise the bar.
    const out = build([
      { bucket: '2026-08-03', numerator: 1, denominator: min },
    ]);
    expect(out.points[0].sparse).toBe(false);
  });

  it('does not flag an empty bucket as sparse', () => {
    // Zero denominator is already "no data" and renders as null. Calling it
    // sparse too would give one absence two different explanations.
    const out = build([{ bucket: '2026-08-03', numerator: 0, denominator: 0 }]);
    expect(out.points[0].sparse).toBe(false);
    expect(out.points[0].value).toBeNull();
  });

  it('keeps the thin bucket in the series rather than dropping it', () => {
    const out = build([
      { bucket: '2026-07-27', numerator: 80, denominator: 800 },
      { bucket: '2026-08-03', numerator: 5, denominator: 2 },
    ]);

    expect(out.points).toHaveLength(2);
    expect(out.points[1].bucket).toBe('2026-08-03');
  });

  it('reads the delta past a thin trailing bucket', () => {
    // The bug in one assertion: without the guard, latest was 2.5 off two turns
    // and the card reported a jump. It should read the last two buckets that
    // can actually carry a rate.
    const out = build([
      { bucket: '2026-07-20', numerator: 50, denominator: 500 },
      { bucket: '2026-07-27', numerator: 80, denominator: 800 },
      { bucket: '2026-08-03', numerator: 5, denominator: 2 },
    ]);

    expect(out.latest).toBeCloseTo(0.1);
    expect(out.previous).toBeCloseTo(0.1);
  });

  it('reports no delta when every bucket is thin', () => {
    // Better than inventing one from two unreliable points.
    const out = build([
      { bucket: '2026-07-27', numerator: 1, denominator: 3 },
      { bucket: '2026-08-03', numerator: 2, denominator: 4 },
    ]);

    expect(out.latest).toBeNull();
    expect(out.previous).toBeNull();
  });
});
