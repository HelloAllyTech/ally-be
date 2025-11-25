import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { ScenarioTenants } from 'src/learn/entity/scenario-tenants.entity';

@Injectable()
export class TenantScenarioSharedService {
  private static readonly logger = LoggerService.getInstance(
    TenantScenarioSharedService.name,
  );

  constructor() {}

  async assignGlobalScenariosToTenant(
    tenantId: string,
    entityManager: EntityManager,
  ): Promise<void> {
    const scenarioRepository = entityManager.getRepository(Scenarios);

    const globalScenarios = await scenarioRepository.find({
      where: { isGlobal: true },
    });

    if (globalScenarios.length === 0) {
      TenantScenarioSharedService.logger.warn(
        'No global scenarios found to assign',
      );
      return;
    }

    const scenarioTenantRepository =
      entityManager.getRepository(ScenarioTenants);

    const scenarioTenantMappings = globalScenarios.map((scenario) => ({
      scenarioId: scenario.id,
      tenantId: tenantId,
    }));

    await scenarioTenantRepository.insert(scenarioTenantMappings);
  }
}
