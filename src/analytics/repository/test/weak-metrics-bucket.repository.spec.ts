import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { WeakMetricsAnalyticsRepository } from '../weak-metrics-analytics.repository';

/**
 * `bucket` is interpolated directly into `date_trunc('${bucket}', ...)` at
 * every call site here — Postgres has no parameter placeholder for a
 * date_trunc field name, so widening `WeakMetricsFilters.bucket` to accept
 * 'quarter' only matters if the SQL actually receives it. Two representative
 * call shapes are pinned: one that buckets off a judgment table via the
 * shared `bucketExpr` helper, one that buckets a raw message/session
 * timestamp inline — a quarter branch missed in either would compute (and
 * cache) silently wrong data rather than error.
 */
describe('WeakMetricsAnalyticsRepository quarter bucket', () => {
  let repository: WeakMetricsAnalyticsRepository;
  let query: jest.Mock;

  const filters = {
    start: new Date('2026-01-01T00:00:00.000Z'),
    bucket: 'quarter',
    language: null,
    llmModel: null,
    scenarioId: null,
    scenarioVersionId: null,
    promptVersion: null,
    judgeModel: null,
    judgePromptVersion: null,
  } as never;

  beforeEach(async () => {
    query = jest.fn().mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeakMetricsAnalyticsRepository,
        { provide: DataSource, useValue: { query } },
      ],
    }).compile();
    repository = module.get(WeakMetricsAnalyticsRepository);
  });

  afterEach(() => jest.clearAllMocks());

  const sql = () => query.mock.calls[0][0] as string;

  it('buckets a judgment-table trend (bucketExpr) by quarter', async () => {
    await repository.unresponsiveTurnTrend(filters);
    expect(sql()).toMatch(/date_trunc\('quarter'/);
  });

  it('buckets a raw-message trend by quarter', async () => {
    await repository.rePromptTrend(filters);
    expect(sql()).toMatch(/date_trunc\('quarter'/);
  });
});
