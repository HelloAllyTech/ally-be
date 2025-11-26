import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioPath } from 'src/scenario-path/entity/scenario-path.entity';
import { ScenarioPathTenant } from 'src/scenario-path/entity/scenario-path-tenant.entity';

@Injectable()
export class TenantScenarioPathSharedService {
  private static readonly logger = LoggerService.getInstance(
    TenantScenarioPathSharedService.name,
  );

  constructor() {}

  async assignGlobalScenarioPathsToTenant(
    tenantId: string,
    entityManager: EntityManager,
  ): Promise<void> {
    const scenarioPathRepo = entityManager.getRepository(ScenarioPath);

    const globalScenarioPaths = await scenarioPathRepo.find({
      where: { isGlobal: true },
    });

    if (globalScenarioPaths.length === 0) {
      TenantScenarioPathSharedService.logger.warn(
        'No global scenario paths found to assign',
      );
      return;
    }

    const scenarioPathTenantRepo =
      entityManager.getRepository(ScenarioPathTenant);

    const mappings = globalScenarioPaths.map((path) => ({
      scenarioPathId: path.id,
      tenantId,
    }));

    await scenarioPathTenantRepo.insert(mappings);
  }
}
