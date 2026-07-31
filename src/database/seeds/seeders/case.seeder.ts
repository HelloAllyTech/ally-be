import { DataSource } from 'typeorm';
import { Case } from '../../../case/entity/case.entity';
import { CaseItem } from '../../../case/entity/case-item.entity';
import { CaseTenant } from '../../../case/entity/case-tenant.entity';
import { CaseSession } from '../../../case/entity/case-session.entity';
import { CaseSessionItem } from '../../../case/entity/case-session-item.entity';
import { Scenarios } from '../../../learn/entity/scenarios.entity';
import { Tenant } from '../../../tenant/entity/tenant.entity';
import { User } from '../../../user/entity/user.entity';
import { SessionItemStatus } from '../../../common/type/common.type';
import { getRepo, log, upsert } from '../helpers';
import { cases, scenarios, defaults } from '../fixtures';

const daysAgo = (n: number): Date =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000);

// caseTitle -> [{ email, completedItemCount }] — how far each learner has
// progressed through that case's ordered items.
const CASE_PROGRESS: Record<
  string,
  Array<{ email: string; completedItemCount: number }>
> = {
  'Mood and Grief Presentations': [
    { email: 'aisha.bello@riversidewellness.io', completedItemCount: 2 },
    { email: 'simran.kaur@brightpathcounseling.net', completedItemCount: 1 },
  ],
  'Risk and Safety Fundamentals': [
    { email: 'daniel.reyes@northwindbh.org', completedItemCount: 2 },
    { email: 'fatima.siddiqui@northwindbh.org', completedItemCount: 0 },
  ],
};

export async function seedCases(
  ds: DataSource,
  adminUserId: number,
): Promise<void> {
  const caseRepo = getRepo(ds, Case);
  const caseItemRepo = getRepo(ds, CaseItem);
  const caseTenantRepo = getRepo(ds, CaseTenant);
  const caseSessionRepo = getRepo(ds, CaseSession);
  const caseSessionItemRepo = getRepo(ds, CaseSessionItem);
  const scenarioRepo = getRepo(ds, Scenarios);
  const tenantRepo = getRepo(ds, Tenant);
  const userRepo = getRepo(ds, User);

  const tenants = await tenantRepo.find();

  const scenarioIdByKey = new Map<string, number>();
  for (const fixture of scenarios) {
    const row = await scenarioRepo.findOne({ where: { title: fixture.title } });
    if (row) scenarioIdByKey.set(fixture.key, row.id);
  }

  let progressCount = 0;

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

    const orderedItems = [];
    for (let i = 0; i < fixture.scenarioKeys.length; i++) {
      const scenarioId = scenarioIdByKey.get(fixture.scenarioKeys[i]);
      if (!scenarioId) continue;
      const item = await upsert(
        caseItemRepo,
        { caseId: caseRow.id, scenarioId },
        {
          order: i + 1,
          minimumScore: 70,
          messageTitle: 'Well done',
          messageContent: 'You have completed this scenario.',
        },
      );
      orderedItems.push(item);
    }

    for (const tenant of tenants) {
      await upsert(
        caseTenantRepo,
        { caseId: caseRow.id, tenantId: tenant.id },
        { caseId: caseRow.id, tenantId: tenant.id },
      );
    }

    for (const progress of CASE_PROGRESS[fixture.title] ?? []) {
      const learner = await userRepo.findOne({
        where: { email: progress.email },
      });
      if (!learner) continue;

      const isDone = progress.completedItemCount >= orderedItems.length;
      const session = await upsert(
        caseSessionRepo,
        { caseId: caseRow.id, userId: learner.id },
        {
          startedAt: daysAgo(10),
          completedAt: isDone ? daysAgo(2) : undefined,
          completedScenarios: progress.completedItemCount,
        },
      );

      for (let i = 0; i < orderedItems.length; i++) {
        await upsert(
          caseSessionItemRepo,
          { caseSessionId: session.id, caseItemId: orderedItems[i].id },
          {
            userId: learner.id,
            status:
              i < progress.completedItemCount
                ? SessionItemStatus.COMPLETED
                : SessionItemStatus.UNLOCKED,
          },
        );
      }
      progressCount++;
    }
  }
  log(
    `cases: ${cases.length} (${progressCount} learner case-session(s) seeded)`,
  );
}
