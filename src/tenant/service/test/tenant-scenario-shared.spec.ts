import { Test, TestingModule } from '@nestjs/testing';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { ScenarioTenants } from 'src/learn/entity/scenario-tenants.entity';
import { TenantScenarioSharedService } from '../tenant-scenario-shared';

describe('TenantScenarioSharedService', () => {
  let service: TenantScenarioSharedService;

  const scenarioRepository = { find: jest.fn() };
  const scenarioTenantRepository = { insert: jest.fn() };
  const statements: string[] = [];

  const entityManager = {
    query: jest.fn(async (sql: string) => {
      statements.push(sql);
      return [];
    }),
    getRepository: jest.fn((entity: unknown) => {
      if (entity === Scenarios) {
        statements.push('select global scenarios');
        return scenarioRepository;
      }
      if (entity === ScenarioTenants) return scenarioTenantRepository;
      return {};
    }),
  };

  beforeEach(async () => {
    statements.length = 0;
    jest.clearAllMocks();
    scenarioRepository.find.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    scenarioTenantRepository.insert.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [TenantScenarioSharedService],
    }).compile();

    service = module.get(TenantScenarioSharedService);
  });

  it('maps every global scenario onto the new tenant', async () => {
    await service.assignGlobalScenariosToTenant(
      'tenant-1',
      entityManager as any,
    );

    expect(scenarioTenantRepository.insert).toHaveBeenCalledWith([
      { scenarioId: 1, tenantId: 'tenant-1' },
      { scenarioId: 2, tenantId: 'tenant-1' },
    ]);
  });

  it('takes the global-scenario fan-out lock before reading the scenario list', async () => {
    // The other half of the createScenarios race: whichever of the two
    // transactions commits second has to do its read after the first one
    // committed, and only a transaction-level lock held across the read
    // guarantees that. A read taken before the lock would still be able to
    // miss a global scenario committing alongside this tenant.
    await service.assignGlobalScenariosToTenant(
      'tenant-1',
      entityManager as any,
    );

    const lockIndex = statements.findIndex((sql) =>
      sql.includes('pg_advisory_xact_lock'),
    );
    const readIndex = statements.indexOf('select global scenarios');

    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeLessThan(readIndex);
  });

  it('still takes the lock when there are no global scenarios to assign', async () => {
    scenarioRepository.find.mockResolvedValue([]);

    await service.assignGlobalScenariosToTenant(
      'tenant-1',
      entityManager as any,
    );

    expect(
      statements.some((sql) => sql.includes('pg_advisory_xact_lock')),
    ).toBe(true);
    expect(scenarioTenantRepository.insert).not.toHaveBeenCalled();
  });
});
