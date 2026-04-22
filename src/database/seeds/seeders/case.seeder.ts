import { DataSource } from 'typeorm';
import { Case } from '../../../case/entity/case.entity';
import { CaseItem } from '../../../case/entity/case-item.entity';
import { CaseTenant } from '../../../case/entity/case-tenant.entity';
import { Scenarios } from '../../../learn/entity/scenarios.entity';
import { Tenant } from '../../../tenant/entity/tenant.entity';
import { getRepo, log, upsert } from '../helpers';
import { cases, scenarios, defaults } from '../fixtures';

export async function seedCases(
  ds: DataSource,
  adminUserId: number,
): Promise<void> {
  const caseRepo = getRepo(ds, Case);
  const caseItemRepo = getRepo(ds, CaseItem);
  const caseTenantRepo = getRepo(ds, CaseTenant);
  const scenarioRepo = getRepo(ds, Scenarios);
  const tenantRepo = getRepo(ds, Tenant);

  const tenants = await tenantRepo.find();

  const scenarioIdByKey = new Map<string, number>();
  for (const fixture of scenarios) {
    const row = await scenarioRepo.findOne({ where: { title: fixture.title } });
    if (row) scenarioIdByKey.set(fixture.key, row.id);
  }

  for (const fixture of cases) {
    const caseRow = await upsert(
      caseRepo,
      { title: fixture.title },
      {
        description: fixture.description,
        status: defaults.caseStatus,
        isGlobal: true,
        totalScenarios: fixture.scenarioKeys.length,
        createdBy: adminUserId,
        updatedBy: adminUserId,
      },
    );

    for (let i = 0; i < fixture.scenarioKeys.length; i++) {
      const scenarioId = scenarioIdByKey.get(fixture.scenarioKeys[i]);
      if (!scenarioId) continue;
      await upsert(
        caseItemRepo,
        { caseId: caseRow.id, scenarioId },
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
        caseTenantRepo,
        { caseId: caseRow.id, tenantId: tenant.id },
        { caseId: caseRow.id, tenantId: tenant.id },
      );
    }
  }
  log(`cases: ${cases.length}`);
}
