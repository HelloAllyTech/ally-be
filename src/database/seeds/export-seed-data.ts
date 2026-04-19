import { config } from 'dotenv';
import { existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { BadgeSeedData } from './badges.seed-data';
import { logStep } from './seed-utils';
import { ScenarioPathwaySeedData } from './scenarios-pathway.seed-data';
import { UserTenantSeedData } from './user-tenant.seed-data';

const allyBeEnv = resolve(__dirname, '../../../.env');
if (existsSync(allyBeEnv)) {
  config({ path: allyBeEnv });
} else {
  config();
}

const DATA_DIR = resolve(__dirname, './data');
const USER_TENANT_OUTPUT = resolve(DATA_DIR, 'user-tenant.json');
const SCENARIO_VOICES_OUTPUT = resolve(DATA_DIR, 'scenario-voices.json');
const SESSION_EVENTS_OUTPUT = resolve(DATA_DIR, 'session-events.json');
const BADGES_OUTPUT = resolve(DATA_DIR, 'badges.json');
const SCENARIOS_PATHWAY_OUTPUT = resolve(DATA_DIR, 'scenarios-pathway.json');

const SEED_LIMITS = {
  tenants: 5,
  users: 24,
  usersPerRole: 2,
  languages: 4,
  voicesPerLanguage: 1,
  sessionEvents: 12,
  badgesPerCategory: 2,
  scenarios: 10,
  paths: 3,
} as const;

type ExportContext = {
  tenantCodes: Set<string>;
  userEmails: Set<string>;
  scenarioLanguageIds: Set<number>;
  scenarioEventCodes: Set<string>;
};

type UserRow = {
  email: string;
  name: string;
  username: string | null;
  phone: string | null;
  externalId: string | null;
  tenantCode: string | null;
  status: string;
  roles: string[] | null;
  adminTenantCodes: string[] | null;
};

type ScenarioRecord = {
  seedKey: string;
  title?: string;
  description?: string;
  coverImageUrl?: string | null;
  coverVideoUrl?: string | null;
  status: any;
  isPublic?: boolean;
  isGlobal?: boolean;
  prompt?: string;
  difficultyLevel?: any;
  responseLength?: any;
  name?: string;
  age?: number;
  gender?: string;
  genderIdentity?: string;
  sexualOrientation?: string;
  currentLocation?: string;
  profession?: string;
  personality?: string;
  tone?: string;
  openingStatements?: string[];
  translationOpeningStatements?: Record<string, string[]>;
  selectedLanguageIds?: number[];
  linguisticStyleSamples?: Record<string, string[]>;
  allowedFillerWords?: Record<string, string[]>;
  competencyName?: string;
  terminationEvents?: Array<{ eventCode: string; message?: string }>;
  triggerWarningNames?: string[];
  customFields?: Record<string, any>[];
  experienceMode?: any;
  checklistType?: string;
  timerMode?: boolean;
  maxTimeValue?: string;
  optGuardrails?: boolean;
  behaviorInstructions?: any[];
  characterProfileText?: string;
  showScoreMeter?: boolean;
  currentState?: string;
  knowledgeSources?: Record<string, any>[];
  stateNames?: Array<{ stateId: string; name: string }>;
  tenantCodes?: string[];
};

type ScenarioPathRecord = {
  title?: string;
  description?: string;
  coverImageUrl?: string | null;
  isGlobal?: boolean;
  status: any;
  scenarios: Array<{
    scenarioSeedKey: string;
    order: number;
    minimumScore?: number;
    messageTitle?: string;
    messageContent?: string;
  }>;
  tenantCodes?: string[];
};

function createClient(): Client {
  return new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl:
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
  });
}

function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function takeFirstPerGroup<T>(
  items: T[],
  getGroupKey: (item: T) => string,
  maxPerGroup: number,
): T[] {
  const counts = new Map<string, number>();
  const selected: T[] = [];

  for (const item of items) {
    const key = getGroupKey(item);
    const current = counts.get(key) || 0;
    if (current >= maxPerGroup) {
      continue;
    }
    counts.set(key, current + 1);
    selected.push(item);
  }

  return selected;
}

async function exportUserTenantData(client: Client): Promise<ExportContext> {
  const tenantsResult = await client.query<{
    code: string;
    name: string;
    description: string | null;
    logoUrl: string | null;
    metadata: Record<string, any> | null;
    settings: Record<string, any> | null;
  }>(`
    select
      code,
      name,
      description,
      "logoUrl",
      metadata,
      settings
    from tenants
    where "deletedAt" is null
    order by code asc
  `);

  const usersResult = await client.query<UserRow>(`
    with user_roles as (
      select
        ug."userId",
        array_agg(distinct g.name order by g.name) as roles
      from user_groups ug
      inner join groups g on g.id = ug."groupId"
      group by ug."userId"
    ),
    admin_tenant_codes as (
      select
        at."userId",
        array_agg(distinct t.code order by t.code) as "adminTenantCodes"
      from admin_tenants at
      inner join tenants t on t.id = at."tenantId"
      where at."deletedAt" is null
        and t."deletedAt" is null
      group by at."userId"
    )
    select
      u.email,
      u.name,
      u.username,
      u.phone,
      u."externalId",
      coalesce(tenant_by_id.code, tenant_by_code.code) as "tenantCode",
      u.status,
      coalesce(ur.roles, '{}'::varchar[]) as roles,
      coalesce(atc."adminTenantCodes", '{}'::varchar[]) as "adminTenantCodes"
    from users u
    left join user_roles ur on ur."userId" = u.id
    left join admin_tenant_codes atc on atc."userId" = u.id
    left join tenants tenant_by_id
      on tenant_by_id.id::text = u.tenant_id
     and tenant_by_id."deletedAt" is null
    left join tenants tenant_by_code
      on tenant_by_code.code = u.tenant_id
     and tenant_by_code."deletedAt" is null
    where not ('SUPER_ADMIN' = any(coalesce(ur.roles, '{}'::varchar[])))
    order by coalesce(tenant_by_id.code, tenant_by_code.code) asc, u.email asc
  `);

  const allUsers = usersResult.rows.filter((user) => user.tenantCode);
  const tenantStats = new Map<
    string,
    { userCount: number; roles: Set<string> }
  >();
  for (const user of allUsers) {
    const tenantCode = user.tenantCode!;
    const stat = tenantStats.get(tenantCode) || {
      userCount: 0,
      roles: new Set<string>(),
    };
    stat.userCount += 1;
    for (const role of user.roles || []) {
      stat.roles.add(role);
    }
    tenantStats.set(tenantCode, stat);
  }

  const selectedTenantCodes = new Set(
    [...tenantStats.entries()]
      .sort((a, b) => {
        const roleDelta = b[1].roles.size - a[1].roles.size;
        if (roleDelta !== 0) return roleDelta;
        return b[1].userCount - a[1].userCount;
      })
      .slice(0, SEED_LIMITS.tenants)
      .map(([tenantCode]) => tenantCode),
  );

  const usersInSelectedTenants = allUsers.filter((user) =>
    selectedTenantCodes.has(user.tenantCode!),
  );
  const distinctRoles = [
    ...new Set(usersInSelectedTenants.flatMap((u) => u.roles || [])),
  ].sort();

  const selectedUsersMap = new Map<string, UserRow>();
  for (const role of distinctRoles) {
    const roleUsers = usersInSelectedTenants.filter((user) =>
      (user.roles || []).includes(role),
    );
    for (const user of roleUsers.slice(0, SEED_LIMITS.usersPerRole)) {
      selectedUsersMap.set(user.email, user);
    }
  }

  for (const user of usersInSelectedTenants) {
    if (selectedUsersMap.size >= SEED_LIMITS.users) {
      break;
    }
    selectedUsersMap.set(user.email, user);
  }

  const selectedUsers = [...selectedUsersMap.values()]
    .sort(
      (a, b) =>
        (a.tenantCode || '').localeCompare(b.tenantCode || '') ||
        a.email.localeCompare(b.email),
    )
    .slice(0, SEED_LIMITS.users);

  const finalTenantCodes = new Set(
    selectedUsers.map((user) => user.tenantCode!),
  );
  const selectedTenants = tenantsResult.rows.filter((tenant) =>
    finalTenantCodes.has(tenant.code),
  );

  const data: UserTenantSeedData = {
    source: {
      generatedAt: new Date().toISOString(),
      database: process.env.DB_DATABASE || 'unknown',
      tenantCount: selectedTenants.length,
      userCount: selectedUsers.length,
    },
    tenants: selectedTenants,
    users: selectedUsers.map((user) => ({
      email: user.email,
      name: user.name,
      username: user.username,
      phone: user.phone,
      externalId: user.externalId,
      tenantCode: user.tenantCode!,
      roles: user.roles ?? [],
      status: user.status as any,
      adminTenantCodes: (user.adminTenantCodes || []).filter((tenantCode) =>
        finalTenantCodes.has(tenantCode),
      ),
    })),
  };

  writeJson(USER_TENANT_OUTPUT, data);
  logStep(
    `[seed-export] Wrote ${data.users.length} users across ${data.tenants.length} tenants`,
  );

  return {
    tenantCodes: finalTenantCodes,
    userEmails: new Set(data.users.map((user) => user.email)),
    scenarioLanguageIds: new Set<number>(),
    scenarioEventCodes: new Set<string>(),
  };
}

async function exportScenariosPathwayData(
  client: Client,
  context: ExportContext,
): Promise<void> {
  const scenariosResult = await client.query<{
    id: number;
    title: string | null;
    description: string | null;
    coverImageUrl: string | null;
    coverVideoUrl: string | null;
    status: string;
    isPublic: boolean;
    isGlobal: boolean;
    prompt: string | null;
    difficultyLevel: string | null;
    competencyId: string | null;
    metadata: Record<string, any> | null;
  }>(`
    select
      id,
      title,
      description,
      "coverImageUrl",
      "coverVideoUrl",
      status,
      "isPublic",
      "isGlobal",
      prompt,
      "difficultyLevel",
      "competencyId",
      metadata
    from scenarios
    where "deletedAt" is null
    order by id asc
  `);

  const competenciesResult = await client.query<{ id: string; name: string }>(`
    select id, name from competencies
  `);
  const competencyNameById = new Map(
    competenciesResult.rows.map((row) => [row.id, row.name]),
  );

  const scenarioEventsResult = await client.query<{
    scenarioId: number;
    eventCode: string;
    message: string | null;
  }>(`
    select
      se."scenarioId",
      sess."eventCode",
      se.message
    from scenario_events se
    inner join session_events sess on sess.id = se."eventId"
    where se."deletedAt" is null
      and se."autoTerminationStatus" = true
      and sess."deletedAt" is null
    order by se."scenarioId" asc, sess."eventCode" asc
  `);

  const triggerWarningsResult = await client.query<{
    scenarioId: number;
    warningName: string;
  }>(`
    select
      stw."scenarioId",
      tw.name as "warningName"
    from scenario_trigger_warnings stw
    inner join trigger_warnings tw on tw.id = stw."triggerWarningId"
    order by stw."scenarioId" asc, tw.name asc
  `);

  const behaviorInstructionsResult = await client.query<{
    id: string;
    scenarioId: number;
    category: string;
    stateInstructions: any[] | null;
  }>(`
    select
      id,
      "scenarioId",
      category,
      "stateInstructions"
    from scenario_behavior_instructions
    where "deletedAt" is null
    order by "scenarioId" asc, "createdAt" asc
  `);

  const behaviorLinksResult = await client.query<{
    scenarioBehaviorInstructionId: string;
    behaviorName: string;
  }>(`
    select
      sbib."scenarioBehaviorInstructionId",
      b.name as "behaviorName"
    from scenario_behavior_instruction_behaviors sbib
    inner join behaviors b on b.id = sbib."behaviorId"
    order by sbib."scenarioBehaviorInstructionId" asc, b.name asc
  `);

  const scenarioTranslationsResult = await client.query<{
    scenarioId: number;
    languageId: number;
    metadata: Record<string, any> | null;
  }>(`
    select
      "scenarioId",
      "languageId",
      metadata
    from scenario_translations
    order by "scenarioId" asc, "languageId" asc
  `);

  const scenarioTenantsResult = await client.query<{
    scenarioId: number;
    tenantCode: string;
  }>(`
    select
      st."scenarioId",
      t.code as "tenantCode"
    from scenario_tenants st
    inner join tenants t on t.id = st."tenantId"
    where st."deletedAt" is null
      and t."deletedAt" is null
    order by st."scenarioId" asc, t.code asc
  `);

  const scenarioPathsResult = await client.query<{
    id: string;
    title: string | null;
    description: string | null;
    coverImageUrl: string | null;
    isGlobal: boolean;
    status: string;
  }>(`
    select
      id,
      title,
      description,
      "coverImageUrl",
      "isGlobal",
      status
    from scenario_paths
    where "deletedAt" is null
    order by id asc
  `);

  const scenarioPathItemsResult = await client.query<{
    scenarioPathId: string;
    scenarioId: number;
    order: number;
    minimumScore: number | null;
    messageTitle: string | null;
    messageContent: string | null;
  }>(`
    select
      "scenarioPathId",
      "scenarioId",
      "order",
      "minimumScore",
      "messageTitle",
      "messageContent"
    from scenario_path_items
    where "deletedAt" is null
    order by "scenarioPathId" asc, "order" asc
  `);

  const scenarioPathTenantsResult = await client.query<{
    scenarioPathId: string;
    tenantCode: string;
  }>(`
    select
      spt."scenarioPathId",
      t.code as "tenantCode"
    from scenario_path_tenants spt
    inner join tenants t on t.id = spt."tenantId"
    where spt."deletedAt" is null
      and t."deletedAt" is null
    order by spt."scenarioPathId" asc, t.code asc
  `);

  const terminationEventsByScenarioId = new Map<
    number,
    Array<{ eventCode: string; message?: string }>
  >();
  for (const row of scenarioEventsResult.rows) {
    terminationEventsByScenarioId.set(row.scenarioId, [
      ...(terminationEventsByScenarioId.get(row.scenarioId) || []),
      {
        eventCode: row.eventCode,
        ...(row.message ? { message: row.message } : {}),
      },
    ]);
  }

  const triggerWarningNamesByScenarioId = new Map<number, string[]>();
  for (const row of triggerWarningsResult.rows) {
    triggerWarningNamesByScenarioId.set(row.scenarioId, [
      ...(triggerWarningNamesByScenarioId.get(row.scenarioId) || []),
      row.warningName,
    ]);
  }

  const behaviorNamesByInstructionId = new Map<string, string[]>();
  for (const row of behaviorLinksResult.rows) {
    behaviorNamesByInstructionId.set(row.scenarioBehaviorInstructionId, [
      ...(behaviorNamesByInstructionId.get(row.scenarioBehaviorInstructionId) ||
        []),
      row.behaviorName,
    ]);
  }

  const behaviorInstructionsByScenarioId = new Map<number, any[]>();
  for (const row of behaviorInstructionsResult.rows) {
    behaviorInstructionsByScenarioId.set(row.scenarioId, [
      ...(behaviorInstructionsByScenarioId.get(row.scenarioId) || []),
      {
        category: row.category,
        stateInstructions: row.stateInstructions || [],
        behaviors: behaviorNamesByInstructionId.get(row.id) || [],
      },
    ]);
  }

  const translationOpeningStatementsByScenarioId = new Map<
    number,
    Record<string, string[]>
  >();
  for (const row of scenarioTranslationsResult.rows) {
    const openingStatements = row.metadata?.openingStatements;
    if (!Array.isArray(openingStatements) || openingStatements.length === 0) {
      continue;
    }
    const existing =
      translationOpeningStatementsByScenarioId.get(row.scenarioId) || {};
    existing[String(row.languageId)] = openingStatements.filter(
      (statement): statement is string => typeof statement === 'string',
    );
    translationOpeningStatementsByScenarioId.set(row.scenarioId, existing);
  }

  const tenantCodesByScenarioId = new Map<number, string[]>();
  for (const row of scenarioTenantsResult.rows) {
    tenantCodesByScenarioId.set(row.scenarioId, [
      ...(tenantCodesByScenarioId.get(row.scenarioId) || []),
      row.tenantCode,
    ]);
  }

  const tenantCodesByPathId = new Map<string, string[]>();
  for (const row of scenarioPathTenantsResult.rows) {
    tenantCodesByPathId.set(row.scenarioPathId, [
      ...(tenantCodesByPathId.get(row.scenarioPathId) || []),
      row.tenantCode,
    ]);
  }

  const scenarioSeedKeyById = new Map<number, string>();
  const allScenarios: Array<ScenarioRecord & { id: number }> =
    scenariosResult.rows.map((scenario) => {
      const seedKey = `scenario-${scenario.id}`;
      scenarioSeedKeyById.set(scenario.id, seedKey);

      const metadata = scenario.metadata || {};
      const selectedLanguageIds = Object.keys(metadata.languageVoices || {})
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id));
      const filteredTenantCodes = (
        tenantCodesByScenarioId.get(scenario.id) || []
      ).filter((tenantCode) => context.tenantCodes.has(tenantCode));

      return {
        id: scenario.id,
        seedKey,
        title: scenario.title || undefined,
        description: scenario.description || undefined,
        coverImageUrl: scenario.coverImageUrl,
        coverVideoUrl: scenario.coverVideoUrl,
        status: scenario.status as any,
        isPublic: scenario.isPublic,
        isGlobal: scenario.isGlobal,
        prompt: scenario.prompt || undefined,
        difficultyLevel: (scenario.difficultyLevel as any) || undefined,
        responseLength: metadata.responseLength,
        name: metadata.name,
        age: metadata.age,
        gender: metadata.gender,
        genderIdentity: metadata.genderIdentity,
        sexualOrientation: metadata.sexualOrientation,
        currentLocation: metadata.currentLocation,
        profession: metadata.profession,
        personality: metadata.personality,
        tone: metadata.tone,
        openingStatements: metadata.openingStatements,
        translationOpeningStatements:
          translationOpeningStatementsByScenarioId.get(scenario.id),
        selectedLanguageIds,
        linguisticStyleSamples: metadata.linguisticStyleSamples,
        allowedFillerWords: metadata.allowedFillerWords,
        competencyName: scenario.competencyId
          ? competencyNameById.get(scenario.competencyId)
          : undefined,
        terminationEvents: terminationEventsByScenarioId.get(scenario.id) || [],
        triggerWarningNames:
          triggerWarningNamesByScenarioId.get(scenario.id) || [],
        customFields: metadata.customFields,
        experienceMode: metadata.experienceMode,
        checklistType: metadata.checklistType,
        timerMode: metadata.timerMode,
        maxTimeValue: metadata.maxTimeValue,
        optGuardrails: metadata.optGuardrails,
        behaviorInstructions:
          behaviorInstructionsByScenarioId.get(scenario.id) || [],
        characterProfileText: metadata.characterProfileText,
        showScoreMeter: metadata.showScoreMeter,
        currentState: metadata.currentState,
        knowledgeSources: metadata.knowledgeSources,
        stateNames: metadata.stateNames,
        tenantCodes: filteredTenantCodes,
      };
    });

  const exportableScenarios = allScenarios.filter(
    (scenario) => scenario.isGlobal || (scenario.tenantCodes || []).length > 0,
  );

  const pathItemsByPathId = new Map<string, any[]>();
  for (const row of scenarioPathItemsResult.rows) {
    pathItemsByPathId.set(row.scenarioPathId, [
      ...(pathItemsByPathId.get(row.scenarioPathId) || []),
      {
        scenarioSeedKey:
          scenarioSeedKeyById.get(row.scenarioId) ||
          `scenario-${row.scenarioId}`,
        order: row.order,
        minimumScore: row.minimumScore || undefined,
        messageTitle: row.messageTitle || undefined,
        messageContent: row.messageContent || undefined,
      },
    ]);
  }

  const exportablePaths: Array<ScenarioPathRecord & { id: string }> =
    scenarioPathsResult.rows.map((path) => ({
      id: path.id,
      title: path.title || undefined,
      description: path.description || undefined,
      coverImageUrl: path.coverImageUrl,
      isGlobal: path.isGlobal,
      status: path.status as any,
      scenarios: pathItemsByPathId.get(path.id) || [],
      tenantCodes: (tenantCodesByPathId.get(path.id) || []).filter(
        (tenantCode) => context.tenantCodes.has(tenantCode),
      ),
    }));

  const selectedScenarioKeys = new Set<string>();
  const selectedPaths: ScenarioPathRecord[] = [];
  const pathCandidates = [...exportablePaths].sort((a, b) => {
    const globalDelta = Number(b.isGlobal) - Number(a.isGlobal);
    if (globalDelta !== 0) return globalDelta;
    return b.scenarios.length - a.scenarios.length;
  });

  for (const path of pathCandidates) {
    if (selectedPaths.length >= SEED_LIMITS.paths) {
      break;
    }
    if (!path.isGlobal && !(path.tenantCodes || []).length) {
      continue;
    }

    const validItems = path.scenarios.filter((item) =>
      exportableScenarios.some(
        (scenario) => scenario.seedKey === item.scenarioSeedKey,
      ),
    );
    const nextScenarioKeys = new Set(selectedScenarioKeys);
    for (const item of validItems) {
      nextScenarioKeys.add(item.scenarioSeedKey);
    }

    if (
      validItems.length === 0 ||
      nextScenarioKeys.size > SEED_LIMITS.scenarios
    ) {
      continue;
    }

    selectedPaths.push({
      ...path,
      scenarios: validItems,
    });
    for (const item of validItems) {
      selectedScenarioKeys.add(item.scenarioSeedKey);
    }
  }

  const selectedScenarios: ScenarioRecord[] = [];
  const scenarioStatusCounts = new Map<string, number>();
  const scenarioCandidates = [...exportableScenarios].sort((a, b) => {
    const globalDelta = Number(b.isGlobal) - Number(a.isGlobal);
    if (globalDelta !== 0) return globalDelta;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });

  for (const scenario of scenarioCandidates) {
    if (selectedScenarioKeys.has(scenario.seedKey)) {
      selectedScenarios.push(scenario);
      scenarioStatusCounts.set(
        String(scenario.status),
        (scenarioStatusCounts.get(String(scenario.status)) || 0) + 1,
      );
    }
  }

  for (const scenario of scenarioCandidates) {
    if (selectedScenarios.length >= SEED_LIMITS.scenarios) {
      break;
    }
    if (selectedScenarioKeys.has(scenario.seedKey)) {
      continue;
    }

    const statusKey = String(scenario.status);
    const currentCount = scenarioStatusCounts.get(statusKey) || 0;
    if (
      currentCount >= 2 &&
      selectedScenarios.length >=
        distinctScenarioStatusCount(scenarioCandidates)
    ) {
      continue;
    }

    selectedScenarios.push(scenario);
    selectedScenarioKeys.add(scenario.seedKey);
    scenarioStatusCounts.set(statusKey, currentCount + 1);
  }

  const finalPaths = selectedPaths
    .map((path) => ({
      ...path,
      scenarios: path.scenarios.filter((item) =>
        selectedScenarioKeys.has(item.scenarioSeedKey),
      ),
    }))
    .filter((path) => path.scenarios.length > 0);

  for (const scenario of selectedScenarios) {
    for (const languageId of scenario.selectedLanguageIds || []) {
      context.scenarioLanguageIds.add(languageId);
    }
    for (const event of scenario.terminationEvents || []) {
      context.scenarioEventCodes.add(event.eventCode);
    }
  }

  const data: ScenarioPathwaySeedData = {
    source: {
      generatedAt: new Date().toISOString(),
      database: process.env.DB_DATABASE || 'unknown',
      scenarioCount: selectedScenarios.length,
      pathCount: finalPaths.length,
    },
    scenarios: selectedScenarios,
    paths: finalPaths,
  };

  writeJson(SCENARIOS_PATHWAY_OUTPUT, data);
  logStep(
    `[seed-export] Wrote ${data.scenarios.length} scenarios and ${data.paths.length} paths`,
  );
}

function distinctScenarioStatusCount(
  scenarios: Array<{ status: any }>,
): number {
  return new Set(scenarios.map((scenario) => String(scenario.status))).size;
}

async function exportScenarioVoices(
  client: Client,
  context: ExportContext,
): Promise<void> {
  const voicesResult = await client.query<{
    name: string;
    provider: string;
    config: Record<string, any> | null;
    languageId: number;
    active: boolean;
  }>(`
    select
      name,
      provider,
      config,
      "languageId",
      active
    from scenario_voices
    order by active desc, "languageId" asc, name asc
  `);

  const preferredLanguageIds =
    context.scenarioLanguageIds.size > 0
      ? [...context.scenarioLanguageIds]
      : [...new Set(voicesResult.rows.map((voice) => voice.languageId))].slice(
          0,
          SEED_LIMITS.languages,
        );

  const languageSet = new Set(preferredLanguageIds);
  const filteredVoices = voicesResult.rows.filter((voice) =>
    languageSet.has(voice.languageId),
  );
  const compactVoices = takeFirstPerGroup(
    filteredVoices,
    (voice) => String(voice.languageId),
    SEED_LIMITS.voicesPerLanguage,
  );

  writeJson(SCENARIO_VOICES_OUTPUT, compactVoices);
  logStep(`[seed-export] Wrote ${compactVoices.length} scenario voices`);
}

async function exportSessionEvents(
  client: Client,
  context: ExportContext,
): Promise<void> {
  const eventsResult = await client.query<{
    id: string;
    name: string;
    description: string | null;
    score: number | null;
    emoji: string | null;
    message: string | null;
    branchInstruction: string | null;
    detectionType: string;
    visibilityType: string;
    detectionData: Record<string, any> | null;
    eventCode: string;
    createdBy: number | null;
    updatedBy: number | null;
    detectionConfig: Record<string, any> | null;
    tags: string[] | null;
  }>(`
    select
      id,
      name,
      description,
      score,
      emoji,
      message,
      "branchInstruction" as "branchInstruction",
      "detectionType" as "detectionType",
      "visibilityType" as "visibilityType",
      "detectionData" as "detectionData",
      "eventCode" as "eventCode",
      "createdBy" as "createdBy",
      "updatedBy" as "updatedBy",
      "detectionConfig" as "detectionConfig",
      tags
    from session_events
    where "deletedAt" is null
    order by "eventCode" asc, id asc
  `);

  const selectedMap = new Map<string, (typeof eventsResult.rows)[number]>();
  for (const row of eventsResult.rows) {
    if (context.scenarioEventCodes.has(row.eventCode)) {
      selectedMap.set(row.eventCode, row);
    }
  }

  const representative = takeFirstPerGroup(
    eventsResult.rows.filter((row) => !selectedMap.has(row.eventCode)),
    (row) => row.detectionType,
    2,
  );
  for (const row of representative) {
    if (selectedMap.size >= SEED_LIMITS.sessionEvents) {
      break;
    }
    selectedMap.set(row.eventCode, row);
  }

  for (const row of eventsResult.rows) {
    if (selectedMap.size >= SEED_LIMITS.sessionEvents) {
      break;
    }
    selectedMap.set(row.eventCode, row);
  }

  const compactEvents = [...selectedMap.values()].slice(
    0,
    SEED_LIMITS.sessionEvents,
  );
  writeJson(SESSION_EVENTS_OUTPUT, compactEvents);
  logStep(`[seed-export] Wrote ${compactEvents.length} session events`);
}

async function exportBadges(
  client: Client,
  context: ExportContext,
): Promise<void> {
  const badgesResult = await client.query<{
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    status: string;
    visibilityType: string;
    category: string;
    achievementParams: Record<string, any> | null;
    translations: Record<string, any> | null;
  }>(`
    select
      id,
      name,
      description,
      "imageUrl",
      status,
      "visibilityType",
      category,
      "achievementParams",
      translations
    from badges
    where "deletedAt" is null
    order by category asc, name asc
  `);

  const badgeGroupsResult = await client.query<{
    badgeId: string;
    groupName: string;
  }>(`
    select
      bg."badgeId",
      g.name as "groupName"
    from badge_groups bg
    inner join groups g on g.id = bg."groupId"
    where bg."deletedAt" is null
    order by bg."badgeId" asc, g.name asc
  `);

  const badgeTenantsResult = await client.query<{
    badgeId: string;
    tenantCode: string;
  }>(`
    select
      bt."badgeId",
      t.code as "tenantCode"
    from badge_tenants bt
    inner join tenants t on t.id = bt."tenantId"
    where bt."deletedAt" is null
      and t."deletedAt" is null
    order by bt."badgeId" asc, t.code asc
  `);

  const badgeUsersResult = await client.query<{
    badgeId: string;
    email: string;
    viewedStatus: string;
  }>(`
    select
      bu."badgeId",
      u.email,
      bu."viewedStatus"
    from badge_users bu
    inner join users u on u.id = bu."userId"
    where bu."deletedAt" is null
    order by bu."badgeId" asc, u.email asc
  `);

  const selectedBadges = takeFirstPerGroup(
    badgesResult.rows,
    (badge) => badge.category,
    SEED_LIMITS.badgesPerCategory,
  );
  const selectedBadgeIds = new Set(selectedBadges.map((badge) => badge.id));

  const groupNamesByBadgeId = new Map<string, string[]>();
  for (const row of badgeGroupsResult.rows) {
    if (!selectedBadgeIds.has(row.badgeId)) continue;
    groupNamesByBadgeId.set(row.badgeId, [
      ...(groupNamesByBadgeId.get(row.badgeId) || []),
      row.groupName,
    ]);
  }

  const tenantCodesByBadgeId = new Map<string, string[]>();
  for (const row of badgeTenantsResult.rows) {
    if (
      !selectedBadgeIds.has(row.badgeId) ||
      !context.tenantCodes.has(row.tenantCode)
    ) {
      continue;
    }
    tenantCodesByBadgeId.set(row.badgeId, [
      ...(tenantCodesByBadgeId.get(row.badgeId) || []),
      row.tenantCode,
    ]);
  }

  const userAssignmentsByBadgeId = new Map<
    string,
    Array<{ email: string; viewedStatus: string }>
  >();
  for (const row of badgeUsersResult.rows) {
    if (
      !selectedBadgeIds.has(row.badgeId) ||
      !context.userEmails.has(row.email)
    ) {
      continue;
    }
    userAssignmentsByBadgeId.set(row.badgeId, [
      ...(userAssignmentsByBadgeId.get(row.badgeId) || []),
      { email: row.email, viewedStatus: row.viewedStatus },
    ]);
  }

  const data: BadgeSeedData = {
    source: {
      generatedAt: new Date().toISOString(),
      database: process.env.DB_DATABASE || 'unknown',
      badgeCount: selectedBadges.length,
    },
    badges: selectedBadges.map((badge) => ({
      name: badge.name,
      description: badge.description,
      imageUrl: badge.imageUrl,
      status: badge.status as any,
      visibilityType: badge.visibilityType as any,
      category: badge.category as any,
      achievementParams: badge.achievementParams,
      translations: badge.translations,
      groupNames: groupNamesByBadgeId.get(badge.id) || [],
      tenantCodes: tenantCodesByBadgeId.get(badge.id) || [],
      userAssignments: (userAssignmentsByBadgeId.get(badge.id) || []).map(
        (assignment) => ({
          email: assignment.email,
          viewedStatus: assignment.viewedStatus as any,
        }),
      ),
    })),
  };

  writeJson(BADGES_OUTPUT, data);
  logStep(`[seed-export] Wrote ${data.badges.length} badges`);
}

async function exportSeedData(): Promise<void> {
  const client = createClient();

  try {
    await client.connect();
    logStep('[seed-export] Database connection established');

    const context = await exportUserTenantData(client);
    await exportScenariosPathwayData(client, context);
    await exportScenarioVoices(client, context);
    await exportSessionEvents(client, context);
    await exportBadges(client, context);

    logStep('[seed-export] ✅ All seed data exported successfully');
  } catch (error: any) {
    console.error('[seed-export] Failed to export seed data:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

exportSeedData();
