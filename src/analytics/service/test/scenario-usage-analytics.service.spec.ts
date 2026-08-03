import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioUsageAnalyticsService } from '../scenario-usage-analytics.service';
import {
  ScenarioUsageAnalyticsRepository,
  ScenarioUsageRow,
} from '../../repository/scenario-usage-analytics.repository';

describe('ScenarioUsageAnalyticsService', () => {
  let service: ScenarioUsageAnalyticsService;
  let repository: jest.Mocked<ScenarioUsageAnalyticsRepository>;

  const setup = async (
    mostUsed: ScenarioUsageRow[] = [],
    leastUsed: ScenarioUsageRow[] = [],
  ) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioUsageAnalyticsService,
        {
          provide: ScenarioUsageAnalyticsRepository,
          useValue: {
            getMostUsed: jest.fn().mockResolvedValue(mostUsed),
            getLeastUsed: jest.fn().mockResolvedValue(leastUsed),
          },
        },
      ],
    }).compile();

    service = module.get(ScenarioUsageAnalyticsService);
    repository = module.get(ScenarioUsageAnalyticsRepository);
  };

  afterEach(() => jest.clearAllMocks());

  it('passes mostUsed/leastUsed through unchanged and requests the shared limit for both', async () => {
    const mostUsed = [{ scenarioId: 1, title: 'A', sessionCount: 10 }];
    const leastUsed = [{ scenarioId: 2, title: 'B', sessionCount: 1 }];
    await setup(mostUsed, leastUsed);

    const result = await service.getScenarioUsage({});

    expect(result.mostUsed).toBe(mostUsed);
    expect(result.leastUsed).toBe(leastUsed);
    const [mostLimit] = repository.getMostUsed.mock.calls[0];
    const [leastLimit] = repository.getLeastUsed.mock.calls[0];
    expect(mostLimit).toBe(leastLimit);
    expect(mostLimit).toBeGreaterThan(0);
  });

  it('trims a blank tenantId to undefined and reports platform-wide scoping', async () => {
    await setup();

    const result = await service.getScenarioUsage({ tenantId: '  ' });

    expect(repository.getMostUsed.mock.calls[0][1]).toBeUndefined();
    expect(repository.getLeastUsed.mock.calls[0][1]).toBeUndefined();
    expect(result.scoping).toEqual({ tenantId: null, unscopedSections: [] });
  });

  it('forwards a real tenantId to both repository calls and echoes it in scoping', async () => {
    await setup();

    const result = await service.getScenarioUsage({ tenantId: 'tenant-1' });

    expect(repository.getMostUsed.mock.calls[0][1]).toBe('tenant-1');
    expect(repository.getLeastUsed.mock.calls[0][1]).toBe('tenant-1');
    expect(result.scoping.tenantId).toBe('tenant-1');
  });
});
