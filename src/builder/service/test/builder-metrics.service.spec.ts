import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { BuilderMetricsService } from '../builder-metrics.service';

/**
 * The metrics service is raw SQL, and the queries themselves are verified by
 * running them against a real database — a mock cannot tell you that
 * `jsonb_each` over a null `cost` column works.
 *
 * What these cover is the mapping layer, where the one real trap lives: a
 * missing measurement must stay missing. `Number(null)` is 0, and a phase with
 * no recorded timing shown as a zero-second phase reads as "instant" rather
 * than "not measured". Every run dispatched before the runner reported timings
 * is exactly that row, so this is the common case, not the edge.
 */
describe('BuilderMetricsService', () => {
  let service: BuilderMetricsService;
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn().mockResolvedValue([]) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuilderMetricsService,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();
    service = module.get(BuilderMetricsService);
  });

  describe('pipelineHealth', () => {
    it('keeps an unmeasured phase unmeasured rather than instant', async () => {
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('jsonb_each')) {
          return Promise.resolve([
            {
              phase: 'plan',
              model: 'claude-opus-5',
              invocations: 1,
              totalCostUsd: '2.0000',
              medianCostUsd: '2',
              // A run from before the runner reported timings.
              medianWallMs: null,
              p95WallMs: null,
              medianApiMs: null,
              medianTurns: null,
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const health = await service.pipelineHealth(30);

      expect(health.phases).toHaveLength(1);
      const [plan] = health.phases;
      expect(plan.totalCostUsd).toBe(2);
      // The point of the test: null, not 0.
      expect(plan.medianWallMs).toBeNull();
      expect(plan.p95WallMs).toBeNull();
      expect(plan.medianApiMs).toBeNull();
      expect(plan.medianTurns).toBeNull();
    });

    it('reads numeric strings back as numbers', async () => {
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('jsonb_each')) {
          return Promise.resolve([
            {
              phase: 'code-1',
              model: 'claude-sonnet-5',
              invocations: 2,
              totalCostUsd: '8.9164',
              medianCostUsd: '4.4582',
              medianWallMs: '2008802',
              p95WallMs: '2008802',
              medianApiMs: '775569',
              medianTurns: '148',
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const [code] = (await service.pipelineHealth(30)).phases;

      expect(code.medianWallMs).toBe(2008802);
      expect(code.medianApiMs).toBe(775569);
      expect(code.medianTurns).toBe(148);
      // Postgres numerics arrive as strings; a consumer doing arithmetic on
      // them would concatenate instead of adding.
      expect(typeof code.totalCostUsd).toBe('number');
    });

    it('rates a gate by results, and says nothing when it has none', async () => {
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('gate_result')) {
          return Promise.resolve([
            { repo: 'ally-be', kind: 'test', results: 2, passed: 1 },
            { repo: 'ally-web', kind: 'lint', results: 0, passed: 0 },
          ]);
        }
        return Promise.resolve([]);
      });

      const { gates } = await service.pipelineHealth(30);

      expect(gates[0].passRate).toBe(0.5);
      // Zero results is not a 0% pass rate — it is no evidence either way.
      expect(gates[1].passRate).toBeNull();
    });

    it('clamps the window to a sane range', async () => {
      await service.pipelineHealth(1);
      expect(dataSource.query).toHaveBeenCalledWith(expect.any(String), ['7']);

      dataSource.query.mockClear();
      await service.pipelineHealth(9999);
      expect(dataSource.query).toHaveBeenCalledWith(expect.any(String), [
        '365',
      ]);

      dataSource.query.mockClear();
      // NaN from an unparseable query param falls back to the default.
      await service.pipelineHealth(Number('nonsense'));
      expect(dataSource.query).toHaveBeenCalledWith(expect.any(String), ['30']);
    });
  });
});
