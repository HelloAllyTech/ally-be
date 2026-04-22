import { DataSource } from 'typeorm';
import { Scenarios } from '../../../learn/entity/scenarios.entity';
import { ScenarioTenants } from '../../../learn/entity/scenario-tenants.entity';
import { ScenarioPath } from '../../../scenario-path/entity/scenario-path.entity';
import { ScenarioPathItem } from '../../../scenario-path/entity/scenario-path-item.entity';
import { ScenarioPathTenant } from '../../../scenario-path/entity/scenario-path-tenant.entity';
import { Tenant } from '../../../tenant/entity/tenant.entity';
import { getRepo, log, upsert } from '../helpers';
import { scenarios, pathways, defaults } from '../fixtures';

export async function seedScenarios(
  ds: DataSource,
  adminUserId: number,
): Promise<void> {
  const scenarioRepo = getRepo(ds, Scenarios);
  const scenarioTenantRepo = getRepo(ds, ScenarioTenants);
  const pathRepo = getRepo(ds, ScenarioPath);
  const pathItemRepo = getRepo(ds, ScenarioPathItem);
  const pathTenantRepo = getRepo(ds, ScenarioPathTenant);
  const tenantRepo = getRepo(ds, Tenant);

  const tenants = await tenantRepo.find();
  const idBySeedKey = new Map<string, number>();

  for (const fixture of scenarios) {
    const scenario = await upsert(
      scenarioRepo,
      { title: fixture.title },
      {
        description: fixture.description,
        status: defaults.scenarioStatus,
        difficultyLevel: defaults.scenarioDifficulty,
        isGlobal: true,
        isPublic: true,
        metadata: fixture.metadata,
        createdBy: adminUserId,
        updatedBy: adminUserId,
      },
    );
    idBySeedKey.set(fixture.key, scenario.id);

    for (const tenant of tenants) {
      await upsert(
        scenarioTenantRepo,
        { scenarioId: scenario.id, tenantId: tenant.id },
        { scenarioId: scenario.id, tenantId: tenant.id },
      );
    }
  }
  log(`scenarios: ${scenarios.length} (linked to ${tenants.length} tenant(s))`);

  for (const fixture of pathways) {
    const path = await upsert(
      pathRepo,
      { title: fixture.title },
      {
        description: fixture.description,
        status: defaults.pathStatus,
        isGlobal: true,
        totalScenarios: fixture.scenarioKeys.length,
        createdBy: adminUserId,
        updatedBy: adminUserId,
      },
    );

    for (let i = 0; i < fixture.scenarioKeys.length; i++) {
      const scenarioId = idBySeedKey.get(fixture.scenarioKeys[i]);
      if (!scenarioId) continue;
      await upsert(
        pathItemRepo,
        { scenarioPathId: path.id, scenarioId },
        {
          order: i + 1,
          minimumScore: 70,
          messageTitle: 'Well done',
          messageContent: 'You have completed this scenario.',
        },
      );
    }

    for (const tenant of tenants) {
      await upsert(
        pathTenantRepo,
        { scenarioPathId: path.id, tenantId: tenant.id },
        { scenarioPathId: path.id, tenantId: tenant.id },
      );
    }
  }
  log(`pathways: ${pathways.length}`);
}
