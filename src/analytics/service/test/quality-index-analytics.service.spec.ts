import { Test, TestingModule } from '@nestjs/testing';

import { QualityIndexAnalyticsService } from '../quality-index-analytics.service';
import { QualityIndexAnalyticsRepository } from '../../repository/quality-index-analytics.repository';
import { QualityThresholdRepository } from '../../repository/quality-threshold.repository';
import { QualityIndexDimension } from '../../constants/quality-index.constants';

jest.mock('../../../logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

const threshold = (
  dimension: QualityIndexDimension,
  target: number,
  ceiling: number,
  calibrated = true,
) => ({
  dimension,
  target,
  ceiling,
  calibrated,
  sampleSize: 100,
  measuredAt: new Date('2026-01-01'),
});

/**
 * `getQualityIndexOverall` is the Goals-tab "Roleplay quality" chart's
 * All-time KPI figure — the SAME weighted-blend logic `getQualityIndex` uses
 * for one bucket, applied to a whole-window raw value per dimension. These
 * tests pin: it queries `getDimensionOverall` (never `getDimensionSeries`,
 * which would mean folding the bucketed series), and it blends exactly like a
 * single bucket does.
 */
describe('QualityIndexAnalyticsService.getQualityIndexOverall', () => {
  let service: QualityIndexAnalyticsService;
  let repo: {
    getDimensionOverall: jest.Mock;
    getDimensionSeries: jest.Mock;
  };
  let thresholdRepo: { findAll: jest.Mock };

  const start = new Date('2026-08-01T00:00:00.000Z');
  const end = new Date('2026-09-01T00:00:00.000Z');

  const overallRow = (raw: number | null, n = 50) => ({ raw, n });

  const setup = async (
    rows: Partial<
      Record<QualityIndexDimension, { raw: number | null; n: number }>
    >,
    thresholds = [
      threshold('actorComposite', 90, 50),
      threshold('driftRate', 2, 20),
      threshold('languageErrors', 2, 20),
      threshold('responseLatency', 1500, 6000),
    ],
  ) => {
    repo = {
      getDimensionOverall: jest.fn(
        async (dimension: QualityIndexDimension) =>
          rows[dimension] ?? overallRow(null, 0),
      ),
      getDimensionSeries: jest.fn().mockResolvedValue([]),
    };
    thresholdRepo = { findAll: jest.fn().mockResolvedValue(thresholds) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QualityIndexAnalyticsService,
        { provide: QualityIndexAnalyticsRepository, useValue: repo },
        { provide: QualityThresholdRepository, useValue: thresholdRepo },
      ],
    }).compile();

    service = module.get(QualityIndexAnalyticsService);
  };

  it('queries getDimensionOverall for every dimension — never getDimensionSeries (no fold of the bucketed series)', async () => {
    await setup({
      actorComposite: overallRow(70),
      driftRate: overallRow(11),
      languageErrors: overallRow(11),
      responseLatency: overallRow(3750),
    });

    await service.getQualityIndexOverall(start, end, 'acme');

    expect(repo.getDimensionOverall).toHaveBeenCalledTimes(4);
    expect(repo.getDimensionOverall).toHaveBeenCalledWith(
      'actorComposite',
      start,
      end,
      'acme',
    );
    expect(repo.getDimensionOverall).toHaveBeenCalledWith(
      'responseLatency',
      start,
      end,
      'acme',
    );
    expect(repo.getDimensionSeries).not.toHaveBeenCalled();
  });

  it('blends all four present dimensions at equal weight (0.25 each)', async () => {
    // Every dimension normalises to exactly 50 by construction (raw sits
    // halfway between each threshold's target and ceiling).
    await setup({
      actorComposite: overallRow(70), // target 90, ceiling 50 -> 50
      driftRate: overallRow(11), // target 2, ceiling 20 -> 50
      languageErrors: overallRow(11), // target 2, ceiling 20 -> 50
      responseLatency: overallRow(3750), // target 1500, ceiling 6000 -> 50
    });

    const result = await service.getQualityIndexOverall(start, end);

    expect(result.index).toBe(50);
    expect(result.missing).toEqual([]);
    expect(result.contributions.actorComposite).toBeCloseTo(12.5, 1);
    expect(
      Object.values(result.contributions).reduce((a, b) => a + b, 0),
    ).toBeCloseTo(50, 1);
    expect(result.raw.actorComposite).toBe(70);
    expect(result.n.actorComposite).toBe(50);
  });

  it('renormalises over the live weight when a dimension has no data', async () => {
    // Three dimensions score 100, one (driftRate) has no data at all.
    await setup({
      actorComposite: overallRow(90), // -> 100
      languageErrors: overallRow(2), // -> 100
      responseLatency: overallRow(1500), // -> 100
      // driftRate omitted entirely.
    });

    const result = await service.getQualityIndexOverall(start, end);

    expect(result.missing).toEqual(['driftRate']);
    // Renormalised over the three live dimensions -> ~100 (99.9 after each
    // contribution rounds to one decimal before summing), not 75 — 75 is
    // what NOT renormalising (scoring the missing dimension as 0) would give.
    expect(result.index).toBeCloseTo(100, 0);
    expect(result.index).not.toBe(75);
  });

  it('is null when no dimension had data in the window', async () => {
    await setup({});

    const result = await service.getQualityIndexOverall(start, end);

    expect(result.index).toBeNull();
    expect(result.missing).toHaveLength(4);
    expect(result.contributions).toEqual({});
  });

  it('treats a dimension with no measured threshold as missing, same as a bucketed point would', async () => {
    await setup(
      {
        actorComposite: overallRow(70),
        driftRate: overallRow(11),
        languageErrors: overallRow(11),
        responseLatency: overallRow(3750),
      },
      [
        threshold('actorComposite', 90, 50),
        threshold('driftRate', 2, 20),
        threshold('languageErrors', 2, 20),
        // responseLatency threshold missing from the resolved list entirely.
      ],
    );

    const result = await service.getQualityIndexOverall(start, end);

    expect(result.missing).toContain('responseLatency');
    expect(result.raw.responseLatency).toBeUndefined();
  });
});
