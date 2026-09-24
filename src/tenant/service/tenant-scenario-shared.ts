import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { ScenarioTenants } from 'src/learn/entity/scenario-tenants.entity';
import {
  SCENARIO_TENANT_LOCK_KEY,
  SCENARIO_TENANT_LOCK_NAMESPACE,
} from 'src/common/constants/advisory-lock.constants';

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
    // The other end of the global-simulation ↔ tenant pairing: duplicating a
    // global simulation fans it out to every tenant (see
    // ScenarioService.duplicateScenario) while this fans every global
    // simulation in to a new tenant. Both ends take the lock, because one end
    // alone serialises nothing — see the constant.
    await entityManager.query('SELECT pg_advisory_xact_lock($1, $2)', [
      SCENARIO_TENANT_LOCK_NAMESPACE,
      SCENARIO_TENANT_LOCK_KEY,
    ]);

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
