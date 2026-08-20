import { WeakMetricsAnalyticsService } from '../weak-metrics-analytics.service';

/**
 * The tab's windows all run up to now, so there is always a partial bucket at
 * the right-hand edge. Charting it made the last point read as a cliff — three
 * days of a week drawn beside seven-day weeks looks like quality collapsing,
 * when it is only the week not being over yet. The fix is to name the bucket so
 * the client can leave it off the plot, which is what every other analytics
 * surface already does via `window.inProgressBucket`.
 *
 * The value must agree with Postgres `date_trunc`, since the buckets it is
 * compared against are produced there — hence Monday-start weeks and UTC.
 */
describe('WeakMetricsAnalyticsService.inProgressBucketOf', () => {
  const call = (bucket: 'week' | 'month'): string =>
    (
      WeakMetricsAnalyticsService as never as {
        inProgressBucketOf: (b: 'week' | 'month') => string;
      }
    ).inProgressBucketOf(bucket);

  it('returns a yyyy-mm-dd date, not an ISO timestamp', () => {
    // The client compares it against bucket keys the SQL formatted with
    // to_char(..., 'YYYY-MM-DD'); a timestamp would never match one.
    expect(call('week')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(call('month')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('starts weeks on Monday, as date_trunc does', () => {
    const iso = call('week');
    // getUTCDay() === 1 is Monday.
    expect(new Date(`${iso}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('starts months on the first', () => {
    expect(call('month').slice(-2)).toBe('01');
  });

  it('never returns a bucket in the future', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(call('week') <= today).toBe(true);
    expect(call('month') <= today).toBe(true);
  });

  it('puts today inside the bucket it names', () => {
    // The whole point is that this is the bucket still accruing — if today fell
    // outside it, the client would drop a completed bucket and keep the partial.
    const weekStart = new Date(`${call('week')}T00:00:00Z`);
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const daysSince = (todayStart.getTime() - weekStart.getTime()) / 86_400_000;
    expect(daysSince).toBeGreaterThanOrEqual(0);
    expect(daysSince).toBeLessThan(7);
  });
});
