import { Test, TestingModule } from '@nestjs/testing';

import { FixSessionEngineCostAnalyticsService } from '../fix-session-engine-cost-analytics.service';
import {
  FixSessionEngineCostAnalyticsRepository,
  FixSessionEngineCostRow,
} from '../../repository/fix-session-engine-cost-analytics.repository';

const FIXED_NOW = new Date('2026-09-17T12:00:00.000Z');

describe('FixSessionEngineCostAnalyticsService', () => {
  let service: FixSessionEngineCostAnalyticsService;
  let getAvgCostByEngine: jest.Mock;

  const setup = async (rows: FixSessionEngineCostRow[] = []) => {
    getAvgCostByEngine = jest.fn().mockResolvedValue(rows);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FixSessionEngineCostAnalyticsService,
        {
          provide: FixSessionEngineCostAnalyticsRepository,
          useValue: {
            getAvgCostByEngine,
            getDataFloor: jest
              .fn()
              .mockResolvedValue(new Date('2026-01-01T00:00:00.000Z')),
          },
        },
      ],
    }).compile();

    service = module.get(FixSessionEngineCostAnalyticsService);
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('passes both engines through with their session counts, rounded to four decimals', async () => {
    await setup([
      { engine: 'claude-code', avgCostUsd: 1.23456789, sessionCount: 12 },
      { engine: 'gemini', avgCostUsd: 0.51, sessionCount: 2 },
    ]);

    const result = await service.getFixSessionEngineCost({ range: '30d' });

    expect(result.byEngine).toEqual([
      { engine: 'claude-code', avgCostUsd: 1.2346, sessionCount: 12 },
      { engine: 'gemini', avgCostUsd: 0.51, sessionCount: 2 },
    ]);
  });

  it('returns an empty list rather than fabricating a comparison when no fix session has completed yet', async () => {
    await setup([]);

    const result = await service.getFixSessionEngineCost({ range: '30d' });

    expect(result.byEngine).toEqual([]);
  });

  it("queries the data floor for range=all so the window starts at the platform's first row", async () => {
    await setup([]);

    await service.getFixSessionEngineCost({});

    const [start] = getAvgCostByEngine.mock.calls[0];
    expect(start).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });

  it('does not query the data floor when an explicit range is given', async () => {
    await setup([]);

    await service.getFixSessionEngineCost({ range: '30d' });

    const [start] = getAvgCostByEngine.mock.calls[0];
    expect(start.getTime()).toBeGreaterThan(
      new Date('2026-01-01T00:00:00.000Z').getTime(),
    );
  });
});
