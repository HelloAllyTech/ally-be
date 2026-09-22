import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { QualityIndexAnalyticsRepository } from '../quality-index-analytics.repository';

/**
 * `getDimensionOverall` is the whole-window counterpart to `getDimensionSeries`
 * — the query behind the Goals-tab "Roleplay quality" chart's All-time KPI
 * figure. It must be a genuinely separate, ungrouped query per dimension, not
 * a fold of the bucketed series: `actorComposite`/`driftRate` are means/rates
 * over sessions, `languageErrors` is a ratio-of-sums across two tables, and
 * `responseLatency` is a percentile — none of those aggregate correctly from
 * pre-bucketed values.
 */
describe('QualityIndexAnalyticsRepository.getDimensionOverall', () => {
  let repository: QualityIndexAnalyticsRepository;
  let query: jest.Mock;

  const start = new Date('2026-08-01T00:00:00.000Z');
  const end = new Date('2026-09-01T00:00:00.000Z');

  beforeEach(async () => {
    query = jest.fn(async () => []);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QualityIndexAnalyticsRepository,
        { provide: DataSource, useValue: { query } },
      ],
    }).compile();
    repository = module.get(QualityIndexAnalyticsRepository);
  });

  const sqlOf = (call = 0) => String(query.mock.calls[call][0]);
  const paramsOf = (call = 0) => query.mock.calls[call][1] as unknown[];

  describe('actorComposite', () => {
    it('is ungrouped — no date_trunc, no GROUP BY, no bucket column', async () => {
      await repository.getDimensionOverall('actorComposite', start, end);

      const sql = sqlOf();
      expect(sql).not.toMatch(/date_trunc/i);
      expect(sql).not.toMatch(/GROUP BY/i);
      expect(sql).toContain('scenario_session_details');
      expect(sql).toContain('avg(d."compositeScore")');
    });

    it('binds the window as parameters, not string interpolation', async () => {
      await repository.getDimensionOverall('actorComposite', start, end);
      expect(paramsOf().slice(0, 2)).toEqual([start, end]);
    });

    it('scopes to a tenant only when one is given', async () => {
      await repository.getDimensionOverall('actorComposite', start, end);
      expect(paramsOf(0)).not.toContain('acme');

      await repository.getDimensionOverall(
        'actorComposite',
        start,
        end,
        'acme',
      );
      expect(paramsOf(1)).toContain('acme');
    });

    it('coerces the raw row and defaults an empty result to null/0', async () => {
      query.mockResolvedValueOnce([{ raw: '72.4', n: '120' }]);
      const withData = await repository.getDimensionOverall(
        'actorComposite',
        start,
        end,
      );
      expect(withData).toEqual({ raw: 72.4, n: 120 });

      query.mockResolvedValueOnce([]);
      const empty = await repository.getDimensionOverall(
        'actorComposite',
        start,
        end,
      );
      expect(empty).toEqual({ raw: null, n: 0 });
    });
  });

  describe('driftRate', () => {
    it('is ungrouped and counts DISTINCT sessions, not rows', async () => {
      await repository.getDimensionOverall('driftRate', start, end);

      const sql = sqlOf();
      expect(sql).not.toMatch(/date_trunc/i);
      expect(sql).not.toMatch(/GROUP BY/i);
      expect(sql).toContain('turn_drift_judgment');
      expect(sql).toContain('COUNT(DISTINCT j."scenarioSessionId")');
    });
  });

  describe('languageErrors', () => {
    it('is ungrouped and joins the numerator/denominator CTEs without a bucket key', async () => {
      await repository.getDimensionOverall('languageErrors', start, end);

      const sql = sqlOf();
      expect(sql).not.toMatch(/date_trunc/i);
      expect(sql).not.toMatch(/GROUP BY/i);
      expect(sql).toContain('language_error_annotations');
      expect(sql).toContain('language_judgment_sessions');
      expect(sql).toMatch(/CROSS JOIN/i);
    });

    it('is null when there are no judged turns (den.turns is NULL)', async () => {
      query.mockResolvedValueOnce([{ raw: null, n: null }]);
      const result = await repository.getDimensionOverall(
        'languageErrors',
        start,
        end,
      );
      expect(result).toEqual({ raw: null, n: 0 });
    });
  });

  describe('responseLatency', () => {
    it('computes a whole-window median via percentile_cont, ungrouped', async () => {
      await repository.getDimensionOverall('responseLatency', start, end);

      const sql = sqlOf();
      expect(sql).not.toMatch(/date_trunc/i);
      expect(sql).not.toMatch(/GROUP BY/i);
      expect(sql).toContain('percentile_cont(0.5)');
      expect(sql).toContain(`m."source" = 'pipeline'`);
    });
  });
});
