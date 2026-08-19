import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { WeakMetricsAnalyticsRepository } from '../weak-metrics-analytics.repository';

/**
 * The turn-conditions panel reads `scenario_session_turn_metrics`, a third of
 * which is transcript-backfilled rows whose "latency" is reconstructed from
 * message timestamps rather than measured voice-to-voice. Their distribution is
 * materially different (p50 7,462ms against 5,259ms in production on
 * 2026-08-20), and because the panel bands with `ntile(4)`, pooling them moved
 * both the fault rates AND the band edges the panel reports.
 *
 * The filter is one clause that is easy to drop in a refactor and impossible to
 * notice afterwards — the panel still renders, just wrong — so it is pinned
 * here rather than left to review.
 */
describe('WeakMetricsAnalyticsRepository.turnConditionBreakdown', () => {
  let repository: WeakMetricsAnalyticsRepository;
  let query: jest.Mock;

  const filters = {
    start: new Date('2026-06-01T00:00:00.000Z'),
    bucket: 'week',
    language: null,
    llmModel: null,
    scenarioId: null,
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

  it('counts only live pipeline rows, not transcript-backfilled ones', async () => {
    await repository.turnConditionBreakdown(filters, undefined as never);

    expect(sql()).toMatch(/m\.source\s*=\s*'pipeline'/);
  });

  it('applies the filter before the quartile bands are computed', async () => {
    // ntile(4) runs over whatever the WHERE let through, so a filter applied
    // afterwards would still leave the band thresholds contaminated. The clause
    // has to sit in the CTE that feeds the bands.
    await repository.turnConditionBreakdown(filters, undefined as never);

    const text = sql();
    const sourceAt = text.indexOf("m.source = 'pipeline'");
    const ntileAt = text.indexOf('ntile(4)');

    expect(sourceAt).toBeGreaterThan(-1);
    expect(ntileAt).toBeGreaterThan(-1);
    expect(sourceAt).toBeLessThan(ntileAt);
  });
});
