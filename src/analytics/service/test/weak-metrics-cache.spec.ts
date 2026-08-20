import { WeakMetricsAnalyticsService } from '../weak-metrics-analytics.service';

/**
 * The tab fans out to 26 aggregates per request and re-runs all of them on every
 * filter change. Warm they are tens of milliseconds each; cold, one measured
 * 1.5s — and the reader pays that on every filter they try. Nothing is slow
 * enough to index away, so the fix is to stop recomputing an answer that cannot
 * have changed inside the judges' 30-minute cadence.
 *
 * What these tests protect is the part that is easy to get wrong and invisible
 * when wrong: that a hit skips the work, that filters do not share an entry, and
 * that a Redis outage degrades to slow rather than to broken.
 */
describe('WeakMetricsAnalyticsService caching', () => {
  const response = { metricsVersion: 'v1', groups: [] };

  const build = (redis: Record<string, jest.Mock>) => {
    const service = new WeakMetricsAnalyticsService(
      {} as never,
      redis as never,
    );
    const compute = jest.fn().mockResolvedValue(response as never);
    (service as never as { computeWeakMetrics: unknown }).computeWeakMetrics =
      compute;
    return { service, compute };
  };

  const redisMock = (hit: string | null = null) => ({
    get: jest.fn().mockResolvedValue(hit),
    set: jest.fn().mockResolvedValue(undefined),
    deleteByPattern: jest.fn().mockResolvedValue(undefined),
  });

  const query = { range: '90d', bucket: 'week' } as never;

  it('computes on a miss and stores the result with a 5 minute TTL', async () => {
    const redis = redisMock(null);
    const { service, compute } = build(redis);

    await service.getWeakMetrics(query);

    expect(compute).toHaveBeenCalledTimes(1);
    // The TTL is the safety argument, not a tuning knob: it has to stay well
    // inside the 30-minute judge cadence for the cache to be unable to hide
    // data that exists.
    expect(redis.set).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify(response),
      300,
    );
  });

  it('serves a hit without running the aggregates', async () => {
    const redis = redisMock(JSON.stringify(response));
    const { service, compute } = build(redis);

    const out = await service.getWeakMetrics(query);

    expect(compute).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(out).toEqual(response);
  });

  it('keys different filter combinations separately', async () => {
    const redis = redisMock(null);
    const { service } = build(redis);

    await service.getWeakMetrics({ range: '90d', language: 'ta-IN' } as never);
    await service.getWeakMetrics({ range: '90d', language: 'en-IN' } as never);

    const [first] = redis.set.mock.calls[0];
    const [second] = redis.set.mock.calls[1];
    // Sharing a key here would serve Tamil's numbers under English, which is
    // worse than any latency this cache saves.
    expect(first).not.toEqual(second);
  });

  it('varies the key by metrics version, so a parameters change is not served stale', async () => {
    const redis = redisMock(null);
    const { service } = build(redis);

    await service.getWeakMetrics(query);
    const [key] = redis.set.mock.calls[0];

    expect(String(key)).toContain('weak-metrics:v1');
  });

  it('computes anyway when the cache read throws', async () => {
    // Redis is an optimisation, not a dependency. A slow tab is a nuisance; a
    // blank tab because a cache is down is an outage.
    const redis = {
      ...redisMock(null),
      get: jest.fn().mockRejectedValue(new Error('redis down')),
    };
    const { service, compute } = build(redis);

    await expect(service.getWeakMetrics(query)).resolves.toEqual(response);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('still returns the response when the cache write throws', async () => {
    const redis = {
      ...redisMock(null),
      set: jest.fn().mockRejectedValue(new Error('redis full')),
    };
    const { service } = build(redis);

    await expect(service.getWeakMetrics(query)).resolves.toEqual(response);
  });
});
