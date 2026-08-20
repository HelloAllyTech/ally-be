import { WeakMetricsAnalyticsService } from '../weak-metrics-analytics.service';
import { WeakMetricState } from '../../dto/weak-metrics.dto';

/**
 * The group badge summarises a mixed set of series. Getting it wrong is not
 * cosmetic: labelling a group "Not measured" while three of its four charts
 * carry real data tells the reader to ignore numbers they can see.
 */
describe('WeakMetricsAnalyticsService.groupState', () => {
  const service = new WeakMetricsAnalyticsService({} as never, {} as never);

  const groupState = (states: WeakMetricState[]) =>
    (service as any).groupState(states.map((state) => ({ state })));

  it('is NONE only when nothing in the group is measured', () => {
    expect(groupState([WeakMetricState.NONE, WeakMetricState.NONE])).toBe(
      WeakMetricState.NONE,
    );
  });

  it('is MEASURED when every series is measured', () => {
    expect(
      groupState([WeakMetricState.MEASURED, WeakMetricState.MEASURED]),
    ).toBe(WeakMetricState.MEASURED);
  });

  it('is PARTIAL when measured and unmeasured series sit together', () => {
    // Actor responsiveness: three measured series plus uninstrumented barge-in.
    expect(
      groupState([
        WeakMetricState.MEASURED,
        WeakMetricState.MEASURED,
        WeakMetricState.MEASURED,
        WeakMetricState.NONE,
      ]),
    ).toBe(WeakMetricState.PARTIAL);
  });

  it('is PARTIAL when any series is itself partial', () => {
    expect(
      groupState([WeakMetricState.MEASURED, WeakMetricState.PARTIAL]),
    ).toBe(WeakMetricState.PARTIAL);
  });

  it('is NONE for an empty group rather than vacuously measured', () => {
    expect(groupState([])).toBe(WeakMetricState.NONE);
  });
});

/**
 * Barge-in is the one metric that cannot be backfilled, so its series has to
 * cross over from "not measured" to "measured" on its own the day the worker
 * deploys. Hard-coding either state is a trap in one direction or the other:
 * `measured` draws a flat pre-deploy zero as if barge-in never happened, and
 * `none` keeps the series blank forever, because the tab will not chart a
 * not-measured series no matter how much data arrives behind it.
 */
describe('WeakMetricsAnalyticsService.instrumentedFrom', () => {
  const service = new WeakMetricsAnalyticsService({} as never, {} as never);

  const build = (rows: Array<[string, number, number]>) =>
    (service as any).instrumentedFrom(
      'barge_in',
      'Turns interrupted by the learner',
      'percent',
      rows.map(([bucket, numerator, denominator]) => ({
        bucket,
        numerator,
        denominator,
      })),
    );

  it('is NONE while nothing has been recorded, however many turns there are', () => {
    const series = build([
      ['2026-06-01', 0, 4000],
      ['2026-07-01', 0, 5200],
    ]);

    expect(series.state).toBe(WeakMetricState.NONE);
    expect(series.points).toEqual([]);
    expect(series.latest).toBeNull();
  });

  it('flips to MEASURED on the first recorded event, with no code change', () => {
    const series = build([
      ['2026-06-01', 0, 4000],
      ['2026-07-01', 0, 5200],
      ['2026-08-01', 91, 5000],
    ]);

    expect(series.state).toBe(WeakMetricState.MEASURED);
    expect(series.latest).toBeCloseTo(91 / 5000);
  });

  it('drops the pre-deploy zeroes instead of drawing them as a step change', () => {
    const series = build([
      ['2026-06-01', 0, 4000],
      ['2026-07-01', 0, 5200],
      ['2026-08-01', 91, 5000],
      ['2026-09-01', 88, 4800],
    ]);

    expect(series.points.map((p: { bucket: string }) => p.bucket)).toEqual([
      '2026-08-01',
      '2026-09-01',
    ]);
    // The delta the tab renders compares two real buckets, not zero -> 1.8%.
    expect(series.previous).toBeCloseTo(91 / 5000);
  });

  it('keeps a genuine zero bucket once instrumentation is live', () => {
    const series = build([
      ['2026-08-01', 91, 5000],
      ['2026-09-01', 0, 4800],
    ]);

    expect(series.state).toBe(WeakMetricState.MEASURED);
    expect(series.points).toHaveLength(2);
    expect(series.latest).toBe(0);
  });
});
