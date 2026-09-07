import { DataSource } from 'typeorm';
import { Scenarios } from '../../../learn/entity/scenarios.entity';
import { ScenarioTenants } from '../../../learn/entity/scenario-tenants.entity';
import { ScenarioTranslations } from '../../../learn/entity/scenario-translation.entity';
import { TriggerWarnings } from '../../../learn/entity/trigger-warnings.entity';
import { ScenarioTriggerWarnings } from '../../../learn/entity/scenario-trigger-warnings.entity';
import { ScenarioPath } from '../../../scenario-path/entity/scenario-path.entity';
import { ScenarioPathItem } from '../../../scenario-path/entity/scenario-path-item.entity';
import { ScenarioPathTenant } from '../../../scenario-path/entity/scenario-path-tenant.entity';
import { ScenarioPathSession } from '../../../scenario-path/entity/scenario-path-session.entity';
import { ScenarioPathSessionItem } from '../../../scenario-path/entity/scenario-path-session-item.entity';
import { SessionItemStatus } from '../../../common/type/common.type';
import { Tenant } from '../../../tenant/entity/tenant.entity';
import { User } from '../../../user/entity/user.entity';
import { Languages } from '../../../language/entity/languages.entity';
import { Competency } from '../../../learn/entity/competency.entity';
import { ScenarioVoices } from '../../../learn/entity/scenario-voices.entity';
import { Behavior } from '../../../learn/entity/behavior.entity';
import { ScenarioBehaviorInstruction } from '../../../learn/entity/scenario-behavior-instruction.entity';
import { ScenarioVersion } from '../../../learn/entity/scenario-version.entity';
import { ScenarioVersionStatus } from '../../../learn/enum/scenario-version-status.enum';
import { ScenarioStatus } from '../../../learn/type/scenario.type';
import { getRepo, log, upsert } from '../helpers';
import {
  scenarios,
  pathways,
  defaults,
  SEED_SCENARIO_PROMPT,
  ScenarioFixture,
} from '../fixtures';

const daysAgo = (n: number): Date =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000);

const PRIMARY_LANGUAGE_ID = 1; // en-IN, seeded by 1765966149367-languagesPreferencesMigration

async function buildLanguageVoices(
  ds: DataSource,
): Promise<Record<string, string>> {
  const voiceRepo = getRepo(ds, ScenarioVoices);
  const enVoice = await voiceRepo.findOne({
    where: { languageId: PRIMARY_LANGUAGE_ID, active: true },
  });
  if (!enVoice) return {};
  return { [String(PRIMARY_LANGUAGE_ID)]: enVoice.id };
}

async function resolveCompetencyId(
  ds: DataSource,
  name: string,
): Promise<string | undefined> {
  const competency = await getRepo(ds, Competency).findOne({ where: { name } });
  return competency?.id;
}

async function seedBehaviorInstructionsFor(
  ds: DataSource,
  scenarioId: number,
  fixture: ScenarioFixture,
  adminUserId: number,
): Promise<number> {
  const behaviorRepo = getRepo(ds, Behavior);
  const instructionRepo = getRepo(ds, ScenarioBehaviorInstruction);

  const existing = await instructionRepo.find({ where: { scenarioId } });
  if (existing.length > 0) return 0;

  let inserted = 0;
  for (const item of fixture.behaviorInstructions) {
    const behaviors = await Promise.all(
      item.behaviorNames.map((name) =>
        behaviorRepo.findOne({ where: { name } }),
      ),
    );
    const resolvedCount = behaviors.filter((b): b is Behavior => !!b).length;
    if (resolvedCount === 0) {
      log(
        `behavior names not found for scenario ${scenarioId} (${item.category}): ${item.behaviorNames.join(', ')}`,
      );
      continue;
    }

    await instructionRepo.save(
      instructionRepo.create({
        scenarioId,
        category: item.category,
        stateInstructions: item.stateInstructions,
        createdBy: adminUserId,
        updatedBy: adminUserId,
      }),
    );
    inserted++;
  }
  return inserted;
}

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
  const languageVoices = await buildLanguageVoices(ds);

  let behaviorInstructionsCreated = 0;

  for (const fixture of scenarios) {
    const competencyId = await resolveCompetencyId(ds, fixture.competencyName);
    if (!competencyId) {
      log(
        `competency "${fixture.competencyName}" not found — scenario "${fixture.title}" will be unpublishable`,
      );
    }

    const scenario = await upsert(
      scenarioRepo,
      { title: fixture.title },
      {
        description: fixture.description,
        status: fixture.status ?? defaults.scenarioStatus,
        difficultyLevel: fixture.difficultyLevel ?? defaults.scenarioDifficulty,
        isGlobal: true,
        isPublic: true,
        coverImageUrl: fixture.coverImageUrl,
        prompt: SEED_SCENARIO_PROMPT,
        competencyId,
        category: fixture.category,
        partnerOrgName: fixture.partnerOrgName,
        metadata: {
          ...fixture.metadata,
          languageVoices,
        },
        createdBy: adminUserId,
        updatedBy: adminUserId,
      },
    );
    idBySeedKey.set(fixture.key, scenario.id);

    behaviorInstructionsCreated += await seedBehaviorInstructionsFor(
      ds,
      scenario.id,
      fixture,
      adminUserId,
    );

    for (const tenant of tenants) {
      await upsert(
        scenarioTenantRepo,
        { scenarioId: scenario.id, tenantId: tenant.id },
        { scenarioId: scenario.id, tenantId: tenant.id },
      );
    }
  }
  log(
    `scenarios: ${scenarios.length} (linked to ${tenants.length} tenant(s), ` +
      `${behaviorInstructionsCreated} behavior instructions added)`,
  );

  // Wire up behavior → instruction join rows that the create-scenario flow
  // normally inserts via ScenarioBehaviorInstructionService. The seeder writes
  // them directly so seeded scenarios behave like UI-created ones.
  await wireBehaviorJoins(ds);
  await wireTriggerWarnings(ds);
  const translationCount = await seedScenarioTranslations(ds);
  log(`scenario translations: ${translationCount}`);

  await seedScenarioVersions(ds, adminUserId, idBySeedKey);

  for (const fixture of pathways) {
    const path = await upsert(
      pathRepo,
      { title: fixture.title },
      {
        description: fixture.description,
        status: fixture.status ?? defaults.pathStatus,
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

  await seedPathProgress(ds);
}

/**
 * Build a scenario_versions `config` snapshot from the scenario row as it
 * exists RIGHT NOW (freshly upserted by seedScenarios, above). Mirrors the
 * field set ScenarioVersionService.buildConfigFromScenario produces, but reads
 * columns directly instead of going through NestJS DI (the seed script has no
 * app context to inject ScenarioService into). triggerWarningIds/
 * terminationEvents/behaviorInstructions/mappedEvents/translation* are left
 * empty — a seed-only limitation, fine for populating the version-history
 * panel, but publishing one of these seeded versions would clear those
 * fields on the live scenario rather than round-tripping them faithfully.
 */
async function buildSeedVersionConfig(
  scenario: Scenarios,
  overrides: Partial<Record<string, any>> = {},
): Promise<Record<string, any>> {
  return {
    mappedEvents: [],
    ...(scenario.metadata ?? {}),
    translationOpeningStatements: {},
    translationDescription: {},
    translationTitle: {},
    translationReminders: {},
    title: scenario.title,
    description: scenario.description,
    prompt: scenario.prompt,
    coverImageUrl: scenario.coverImageUrl,
    coverVideoUrl: scenario.coverVideoUrl ?? null,
    isPublic: scenario.isPublic,
    isGlobal: scenario.isGlobal,
    difficultyLevel: scenario.difficultyLevel,
    competencyId: scenario.competencyId,
    category: scenario.category,
    partnerOrgName: scenario.partnerOrgName,
    status: ScenarioStatus.DRAFT,
    triggerWarningIds: [],
    terminationEvents: [],
    behaviorInstructions: [],
    ...overrides,
  };
}

/**
 * Populate scenario_versions so the version-history panel isn't empty for
 * every scenario. Mirrors ScenarioVersionService semantics: v1 is the
 * parentless baseline (PUBLISHED iff the scenario is ACTIVE, and sets
 * scenarios.publishedVersionId); a draft has parentVersionId set and forces
 * config.status = DRAFT.
 */
async function seedScenarioVersions(
  ds: DataSource,
  adminUserId: number,
  idBySeedKey: Map<string, number>,
): Promise<void> {
  const scenarioRepo = getRepo(ds, Scenarios);
  const versionRepo = getRepo(ds, ScenarioVersion);

  let created = 0;

  const copingId = idBySeedKey.get('coping-with-depression');
  if (copingId) {
    const scenario = await scenarioRepo.findOneOrFail({
      where: { id: copingId },
    });
    const existing = await versionRepo.find({
      where: { scenarioId: copingId },
    });
    if (existing.length === 0) {
      const baselineConfig = await buildSeedVersionConfig(scenario, {
        status: scenario.status,
      });
      const v1 = await versionRepo.save(
        versionRepo.create({
          scenarioId: copingId,
          versionNumber: 1,
          config: baselineConfig,
          status:
            scenario.status === ScenarioStatus.ACTIVE
              ? ScenarioVersionStatus.PUBLISHED
              : ScenarioVersionStatus.DRAFT,
          createdBy: adminUserId,
          updatedBy: adminUserId,
        }),
      );
      if (scenario.status === ScenarioStatus.ACTIVE) {
        await scenarioRepo.update(copingId, { publishedVersionId: v1.id });
      }
      created++;

      await versionRepo.save(
        versionRepo.create({
          scenarioId: copingId,
          versionNumber: 2,
          name: 'warmer opener',
          parentVersionId: v1.id,
          config: await buildSeedVersionConfig(scenario, {
            status: ScenarioStatus.DRAFT,
            openingStatements: [
              'I know this is a lot to put on you, but thank you for making space for me today.',
              'I have been carrying this for a while and I am glad to have somewhere to bring it.',
            ],
          }),
          status: ScenarioVersionStatus.DRAFT,
          createdBy: adminUserId,
          updatedBy: adminUserId,
        }),
      );
      created++;

      await versionRepo.save(
        versionRepo.create({
          scenarioId: copingId,
          versionNumber: 3,
          name: 'pre-launch cut',
          parentVersionId: v1.id,
          config: await buildSeedVersionConfig(scenario, {
            status: ScenarioStatus.ARCHIVED,
            description:
              'Practice a supportive conversation with a client experiencing low mood.',
          }),
          status: ScenarioVersionStatus.ARCHIVED,
          createdBy: adminUserId,
          updatedBy: adminUserId,
          createdAt: daysAgo(40),
        }),
      );
      created++;
    }
  }

  // The DRAFT scenario gets just its baseline — a DRAFT scenario's baseline
  // stays DRAFT and never sets publishedVersionId.
  const draftScenarioId = idBySeedKey.get('workplace-burnout-checkin');
  if (draftScenarioId) {
    const existing = await versionRepo.find({
      where: { scenarioId: draftScenarioId },
    });
    if (existing.length === 0) {
      const scenario = await scenarioRepo.findOneOrFail({
        where: { id: draftScenarioId },
      });
      await versionRepo.save(
        versionRepo.create({
          scenarioId: draftScenarioId,
          versionNumber: 1,
          config: await buildSeedVersionConfig(scenario, {
            status: ScenarioStatus.DRAFT,
          }),
          status: ScenarioVersionStatus.DRAFT,
          createdBy: adminUserId,
          updatedBy: adminUserId,
        }),
      );
      created++;
    }
  }

  log(`scenario versions: ${created} created`);
}

/**
 * Learner progress through "Mental Health Counseling Fundamentals": one
 * learner who finished it, one who is midway through item 2.
 */
async function seedPathProgress(ds: DataSource): Promise<void> {
  const pathRepo = getRepo(ds, ScenarioPath);
  const pathItemRepo = getRepo(ds, ScenarioPathItem);
  const pathSessionRepo = getRepo(ds, ScenarioPathSession);
  const pathSessionItemRepo = getRepo(ds, ScenarioPathSessionItem);
  const userRepo = getRepo(ds, User);

  const path = await pathRepo.findOne({
    where: { title: 'Mental Health Counseling Fundamentals' },
  });
  if (!path) return;

  const items = await pathItemRepo.find({ where: { scenarioPathId: path.id } });
  items.sort((a, b) => a.order - b.order);
  if (items.length < 2) return;

  const finisher = await userRepo.findOne({
    where: { email: 'lucia.fernandez@riversidewellness.io' },
  });
  const inProgress = await userRepo.findOne({
    where: { email: 'tobias.becker@riversidewellness.io' },
  });

  if (finisher) {
    const session = await upsert(
      pathSessionRepo,
      { scenarioPathId: path.id, userId: finisher.id },
      {
        startedAt: daysAgo(20),
        completedAt: daysAgo(15),
        completedScenarios: items.length,
      },
    );
    for (const item of items) {
      await upsert(
        pathSessionItemRepo,
        { scenarioPathSessionId: session.id, scenarioPathItemId: item.id },
        { userId: finisher.id, status: SessionItemStatus.COMPLETED },
      );
    }
  }

  if (inProgress) {
    const session = await upsert(
      pathSessionRepo,
      { scenarioPathId: path.id, userId: inProgress.id },
      { startedAt: daysAgo(6), completedScenarios: 1 },
    );
    for (let i = 0; i < items.length; i++) {
      await upsert(
        pathSessionItemRepo,
        { scenarioPathSessionId: session.id, scenarioPathItemId: items[i].id },
        {
          userId: inProgress.id,
          status:
            i === 0 ? SessionItemStatus.COMPLETED : SessionItemStatus.UNLOCKED,
        },
      );
    }
  }

  log('scenario path progress: 2 learners (1 completed, 1 in-progress)');
}

/**
 * Populate the scenario_behavior_instruction_behaviors join table for every
 * seeded ScenarioBehaviorInstruction row. We resolve behavior IDs by the
 * `behaviorNames` declared in the fixture and insert the (instructionId,
 * behaviorId) pairs idempotently.
 */
async function wireBehaviorJoins(ds: DataSource): Promise<void> {
  const instructionRepo = getRepo(ds, ScenarioBehaviorInstruction);
  const behaviorRepo = getRepo(ds, Behavior);

  for (const fixture of scenarios) {
    const scenarioRow = await getRepo(ds, Scenarios).findOne({
      where: { title: fixture.title },
    });
    if (!scenarioRow) continue;

    const instructions = await instructionRepo.find({
      where: { scenarioId: scenarioRow.id },
    });

    for (const fixtureItem of fixture.behaviorInstructions) {
      const matchingInstruction = instructions.find(
        (i) => i.category === fixtureItem.category,
      );
      if (!matchingInstruction) continue;

      const behaviorIds: string[] = [];
      for (const name of fixtureItem.behaviorNames) {
        const b = await behaviorRepo.findOne({ where: { name } });
        if (b) behaviorIds.push(b.id);
      }

      for (const behaviorId of behaviorIds) {
        await ds.query(
          `INSERT INTO "scenario_behavior_instruction_behaviors" ("scenarioBehaviorInstructionId", "behaviorId")
           SELECT $1::uuid, $2::uuid
           WHERE NOT EXISTS (
             SELECT 1 FROM "scenario_behavior_instruction_behaviors"
             WHERE "scenarioBehaviorInstructionId" = $1::uuid AND "behaviorId" = $2::uuid
           )`,
          [matchingInstruction.id, behaviorId],
        );
      }
    }
  }
}

async function wireTriggerWarnings(ds: DataSource): Promise<void> {
  const triggerWarningRepo = getRepo(ds, TriggerWarnings);
  const joinRepo = getRepo(ds, ScenarioTriggerWarnings);
  const scenarioRepo = getRepo(ds, Scenarios);

  for (const fixture of scenarios) {
    if (!fixture.triggerWarningNames?.length) continue;
    const scenarioRow = await scenarioRepo.findOne({
      where: { title: fixture.title },
    });
    if (!scenarioRow) continue;

    for (const name of fixture.triggerWarningNames) {
      const warning = await triggerWarningRepo.findOne({ where: { name } });
      if (!warning) continue;
      await upsert(
        joinRepo,
        { scenarioId: scenarioRow.id, triggerWarningId: warning.id },
        { scenarioId: scenarioRow.id, triggerWarningId: warning.id },
      );
    }
  }
}

/**
 * Non-English scenario metadata for the fixtures that declare
 * `translationsByLanguage` — enough to exercise the language switcher
 * without translating the entire catalog.
 */
async function seedScenarioTranslations(ds: DataSource): Promise<number> {
  const translationRepo = getRepo(ds, ScenarioTranslations);
  const scenarioRepo = getRepo(ds, Scenarios);
  const languageRepo = getRepo(ds, Languages);

  let count = 0;
  for (const fixture of scenarios) {
    if (!fixture.translationsByLanguage) continue;
    const scenarioRow = await scenarioRepo.findOne({
      where: { title: fixture.title },
    });
    if (!scenarioRow) continue;

    // applyScenarioTranslations (what actually translates the catalog LIST,
    // as opposed to the detail view) reads scenarios.translations, keyed by
    // the short translationCode ('hi'/'mr'/'ta'), not scenario_translations —
    // both must be written or the language switcher only half-works.
    const translationsJsonb: Record<
      string,
      { title?: string; description?: string }
    > = { ...(scenarioRow.translations ?? {}) };

    for (const [languageValue, translation] of Object.entries(
      fixture.translationsByLanguage,
    )) {
      const language = await languageRepo.findOne({
        where: { value: languageValue },
      });
      if (!language) continue;
      await upsert(
        translationRepo,
        { scenarioId: scenarioRow.id, languageId: language.id },
        { metadata: translation },
      );
      count++;

      if (translation.title || translation.description) {
        translationsJsonb[language.translationCode] = {
          title: translation.title,
          description: translation.description,
        };
      }
    }

    if (Object.keys(translationsJsonb).length > 0) {
      await scenarioRepo.update(scenarioRow.id, {
        translations: translationsJsonb as Scenarios['translations'],
      });
    }
  }
  return count;
}
