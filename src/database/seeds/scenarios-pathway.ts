import axios, { AxiosInstance } from 'axios';
import { config } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { logStep } from './seed-utils';
import {
  ExperienceMode,
  ScenarioDifficultyLevel,
  ScenarioResponseLength,
  ScenarioStatus,
} from '../../learn/type/scenario.type';
import {
  ScenarioPathSeedRecord,
  ScenarioPathwaySeedData,
  ScenarioSeedRecord,
} from './scenarios-pathway.seed-data';
import { ScenarioPathStatus } from '../../scenario-path/type/scenario-paths.type';

const allyBeEnv = resolve(__dirname, '../../../.env');
if (existsSync(allyBeEnv)) {
  config({ path: allyBeEnv });
} else {
  config();
}

const API_BASE_URL = process.env.SEED_API_BASE_URL || 'http://localhost:8001';
const SCENARIO_DATA_FILE = resolve(__dirname, './data/scenarios-pathway.json');

const adminCredentials = {
  username: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
  password: process.env.SEED_ADMIN_PASSWORD || 'Password123!',
};

const MIN_TIMER_SECONDS = 5 * 60;
const MAX_TIMER_SECONDS = 2 * 60 * 60;
const DEFAULT_PATH_MINIMUM_SCORE = 70;

function defaultStateNames(): { stateId: string; name: string }[] {
  return [
    { stateId: '-1', name: 'State -1' },
    { stateId: '1', name: 'State 1' },
    { stateId: '2', name: 'State 2' },
    { stateId: '3', name: 'State 3' },
  ];
}

function fallbackLinguisticStyleSamples(
  languageIds: number[],
): Record<string, string[]> {
  const samples = [
    'I am not sure where to start, but things have felt overwhelming.',
    'It has been building up for a while now.',
    'Some days I cope fine; other days not so much.',
    'I keep replaying things in my head after work.',
    'I do not want to sound dramatic, but it has been hard.',
    'Maybe I am overreacting, I honestly do not know.',
    'Even small tasks feel like too much lately.',
    'I have tried to just push through, but it is tiring.',
    'Talking about it feels a bit awkward, if I am honest.',
    'I hope I can sort this out with a bit of support.',
  ];

  return Object.fromEntries(
    languageIds.map((id) => [String(id), [...samples]]),
  );
}

function parseTimeToSeconds(value?: string | null): number | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, hours, minutes, seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

function formatSecondsAsTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}

function normalizeTimerSettings(scenario: ScenarioSeedRecord): {
  timerMode: boolean | undefined;
  maxTimeValue: string | undefined;
} {
  if (!scenario.timerMode) {
    return {
      timerMode: scenario.timerMode,
      maxTimeValue: undefined,
    };
  }

  const parsedSeconds = parseTimeToSeconds(scenario.maxTimeValue);
  if (parsedSeconds === null) {
    logStep(
      `[scenarios-pathway] Invalid timer value "${scenario.maxTimeValue}" for "${scenario.title}". Using 00:05:00 instead.`,
    );
    return {
      timerMode: true,
      maxTimeValue: formatSecondsAsTime(MIN_TIMER_SECONDS),
    };
  }

  const clampedSeconds = Math.max(
    MIN_TIMER_SECONDS,
    Math.min(MAX_TIMER_SECONDS, parsedSeconds),
  );

  if (clampedSeconds !== parsedSeconds) {
    logStep(
      `[scenarios-pathway] Adjusted timer value for "${scenario.title}" from ${scenario.maxTimeValue} to ${formatSecondsAsTime(clampedSeconds)}.`,
    );
  }

  return {
    timerMode: true,
    maxTimeValue: formatSecondsAsTime(clampedSeconds),
  };
}

function resolveScenarioLanguageIds(
  scenario: ScenarioSeedRecord,
  availableVoicesByLanguage: Record<string, string>,
): number[] {
  const selectedLanguageIds = (scenario.selectedLanguageIds || []).filter(
    (id) => Boolean(availableVoicesByLanguage[String(id)]),
  );
  const sampleLanguageIds = Object.keys(scenario.linguisticStyleSamples || {})
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id))
    .filter((id) => Boolean(availableVoicesByLanguage[String(id)]));

  if (selectedLanguageIds.length > 0 && sampleLanguageIds.length > 0) {
    const intersection = selectedLanguageIds.filter((id) =>
      sampleLanguageIds.includes(id),
    );
    if (intersection.length > 0) {
      return intersection;
    }
  }

  if (sampleLanguageIds.length > 0) {
    return sampleLanguageIds;
  }

  if (selectedLanguageIds.includes(1)) {
    return [1];
  }

  if (selectedLanguageIds.length > 0) {
    return [selectedLanguageIds[0]];
  }

  if (availableVoicesByLanguage['1']) {
    return [1];
  }

  const fallbackLanguageId = Object.keys(availableVoicesByLanguage)
    .map((id) => Number(id))
    .find((id) => Number.isFinite(id));

  return fallbackLanguageId ? [fallbackLanguageId] : [];
}

function buildLinguisticStyleSamplesForScenario(
  scenario: ScenarioSeedRecord,
  languageIds: number[],
): Record<string, string[]> {
  const existing = scenario.linguisticStyleSamples || {};
  const fallback = fallbackLinguisticStyleSamples(languageIds);

  return Object.fromEntries(
    languageIds.map((languageId) => {
      const key = String(languageId);
      const existingSamples = Array.isArray(existing[key])
        ? existing[key].filter(
            (sample): sample is string =>
              typeof sample === 'string' && sample.trim().length > 0,
          )
        : [];

      return [
        key,
        existingSamples.length > 0 ? existingSamples : fallback[key],
      ];
    }),
  );
}

const fallbackSeedData: ScenarioPathwaySeedData = {
  source: {
    generatedAt: new Date(0).toISOString(),
    database: 'fallback',
    scenarioCount: 2,
    pathCount: 1,
  },
  scenarios: [
    {
      seedKey: 'scenario-1',
      title: 'Active Listening Basics',
      description:
        'Practice listening skills with Alex, a young professional feeling overwhelmed.',
      coverImageUrl: 'https://placehold.co/400x300/png?text=Active+Listening',
      status: ScenarioStatus.ACTIVE,
      isGlobal: true,
      isPublic: true,
      difficultyLevel: ScenarioDifficultyLevel.EASY,
      responseLength: ScenarioResponseLength.VERY_BRIEF,
      name: 'Alex Johnson',
      age: 25,
      gender: 'male',
      genderIdentity: 'Male/Man',
      sexualOrientation: 'Heterosexual (straight)',
      profession: 'Software Engineer',
      currentLocation: 'Kochi, India',
      tone: 'Casual',
      selectedLanguageIds: [1],
      prompt:
        'You are an AI roleplay assistant for counselor training. Stay fully in character as the client in a therapy session.',
      openingStatements: [
        'I am not sure where to start...',
        'Everything feels like it is piling up.',
      ],
      experienceMode: ExperienceMode.FEEDBACK,
      timerMode: false,
      showScoreMeter: false,
      competencyName: 'Counseling Fundamentals',
      characterProfileText:
        'Alex is a 25-year-old software engineer from Kochi, India struggling with work-life balance and stress.',
      behaviorInstructions: [
        {
          category: 'SHOULD_DO',
          behaviors: ['Active Listening', 'Empathy'],
          stateInstructions: [
            {
              stateId: '-1',
              instruction: 'Use an open, warm greeting to build rapport',
            },
            {
              stateId: '1',
              instruction: 'Reflect feelings about stress and workload',
            },
            {
              stateId: '2',
              instruction:
                'Ask one open-ended question to deepen understanding',
            },
            {
              stateId: '3',
              instruction: 'Summarize key concern and validate effort',
            },
          ],
        },
      ],
    },
    {
      seedKey: 'scenario-2',
      title: 'Managing Workplace Anxiety',
      description:
        'Practice empathetic responses with Priya, a mid-level professional experiencing anxiety at work.',
      coverImageUrl: 'https://placehold.co/400x300/png?text=Workplace+Anxiety',
      status: ScenarioStatus.ACTIVE,
      isGlobal: true,
      isPublic: true,
      difficultyLevel: ScenarioDifficultyLevel.MEDIUM,
      responseLength: ScenarioResponseLength.VERY_BRIEF,
      name: 'Priya Nair',
      age: 29,
      gender: 'female',
      genderIdentity: 'Female/Woman',
      sexualOrientation: 'Heterosexual (straight)',
      profession: 'Product Manager',
      currentLocation: 'Bengaluru, India',
      tone: 'Thoughtful',
      selectedLanguageIds: [1],
      prompt:
        'You are an AI roleplay assistant for counselor training. Stay fully in character as the client in a therapy session.',
      openingStatements: [
        'I have been feeling on edge at work lately.',
        'Even small tasks are starting to feel stressful.',
      ],
      experienceMode: ExperienceMode.FEEDBACK,
      timerMode: false,
      showScoreMeter: false,
      competencyName: 'Counseling Fundamentals',
      characterProfileText:
        'Priya is a 29-year-old product manager from Bengaluru, India who is experiencing anxiety due to workplace pressure.',
      behaviorInstructions: [
        {
          category: 'SHOULD_DO',
          behaviors: ['Active Listening', 'Empathy'],
          stateInstructions: [
            {
              stateId: '-1',
              instruction: 'Offer brief validation to reduce immediate tension',
            },
            {
              stateId: '1',
              instruction: 'Invite specifics about triggers and contexts',
            },
            {
              stateId: '2',
              instruction: 'Reflect patterns and name one emerging theme',
            },
            {
              stateId: '3',
              instruction: 'Summarize strengths and set one small next step',
            },
          ],
        },
      ],
    },
  ],
  paths: [
    {
      title: 'Counseling Fundamentals Path',
      description:
        'A learning path covering basic counseling skills from active listening to handling emotional situations.',
      status: ScenarioPathStatus.ACTIVE,
      isGlobal: true,
      coverImageUrl: 'https://placehold.co/400x300/png?text=Learning+Path',
      scenarios: [
        {
          scenarioSeedKey: 'scenario-1',
          order: 1,
          minimumScore: 70,
          messageTitle: 'Great Start!',
          messageContent: 'You have completed the first scenario. Keep going!',
        },
        {
          scenarioSeedKey: 'scenario-2',
          order: 2,
          minimumScore: 70,
          messageTitle: 'Well Done!',
          messageContent: 'Congratulations on completing this scenario!',
        },
      ],
    },
  ],
};

function loadScenarioSeedData(): ScenarioPathwaySeedData {
  if (!existsSync(SCENARIO_DATA_FILE)) {
    logStep(
      `[scenarios-pathway] Seed data file not found at ${SCENARIO_DATA_FILE}. Falling back to built-in scenario data.`,
    );
    return fallbackSeedData;
  }

  const raw = readFileSync(SCENARIO_DATA_FILE, 'utf8');
  const parsed = JSON.parse(raw) as ScenarioPathwaySeedData;
  logStep(
    `[scenarios-pathway] Loaded scenario dataset from ${SCENARIO_DATA_FILE} (${parsed.scenarios.length} scenarios / ${parsed.paths.length} paths)`,
  );
  return parsed;
}

async function login(
  client: AxiosInstance,
  credentials: { username: string; password: string },
): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await client.post('/api/v1/auth/login', credentials);
  return {
    accessToken: response.data.accessToken,
    refreshToken: response.data.refreshToken,
  };
}

async function mapAvailableVoicesByLanguage(
  client: AxiosInstance,
  accessToken: string,
): Promise<Record<string, string>> {
  const response = await client.get('/api/v1/learn/scenario-voices', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const voicesByLanguage: Record<string, string> = {};
  for (const voice of response.data || []) {
    const key = String(voice.languageId);
    if (!voicesByLanguage[key] && voice.id) {
      voicesByLanguage[key] = voice.id;
    }
  }

  return voicesByLanguage;
}

async function getSessionEventsByCode(
  client: AxiosInstance,
  accessToken: string,
): Promise<Map<string, { id: string; name: string }>> {
  const response = await client.get(
    '/api/v1/session-events?offset=0&limit=1000&searchName=',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  return new Map(
    (response.data?.data || []).map((event: any) => [
      event.eventCode,
      { id: event.id, name: event.name },
    ]),
  );
}

async function getTriggerWarningsByName(
  client: AxiosInstance,
  accessToken: string,
): Promise<Map<string, string>> {
  const response = await client.get(
    '/api/v1/learn/trigger-warnings?name=&offset=0&limit=1000',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  return new Map(
    (response.data || []).map((warning: any) => [warning.name, warning.id]),
  );
}

async function getTenantsByCode(
  client: AxiosInstance,
  accessToken: string,
): Promise<Map<string, string>> {
  const response = await client.get('/api/v1/tenants?offset=0&limit=1000', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return new Map(
    (response.data?.data || []).map((tenant: any) => [tenant.code, tenant.id]),
  );
}

async function getOrCreateCompetencyId(
  client: AxiosInstance,
  accessToken: string,
  competencyName: string,
  cache: Map<string, string>,
): Promise<string> {
  const cached = cache.get(competencyName);
  if (cached) {
    return cached;
  }

  try {
    const response = await client.get(
      `/api/v1/learn/competencies?name=${encodeURIComponent(competencyName)}&offset=0&limit=1`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (response.data?.data?.length > 0) {
      const id = response.data.data[0].id;
      cache.set(competencyName, id);
      return id;
    }
  } catch {
    // fall through to create
  }

  const createResponse = await client.post(
    '/api/v1/learn/competencies',
    { name: competencyName },
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  cache.set(competencyName, createResponse.data.id);
  return createResponse.data.id;
}

async function getOrCreateBehaviorIdsByName(
  client: AxiosInstance,
  accessToken: string,
  names: string[],
): Promise<Map<string, string>> {
  const response = await client.get(
    '/api/v1/learn/scenario-behaviors?offset=0&limit=1000',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  const existing = new Map<string, string>(
    (response.data?.data || []).map((behavior: any) => [
      behavior.name,
      behavior.id,
    ]),
  );

  const missingNames = names.filter((name) => !existing.has(name));
  if (missingNames.length > 0) {
    const createResponse = await client.post(
      '/api/v1/learn/scenario-behaviors/bulk-insertions',
      {
        behaviors: missingNames.map((name) => ({ name })),
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    for (const behavior of createResponse.data?.behaviors || []) {
      existing.set(behavior.name, behavior.id);
    }
  }

  return existing;
}

function buildLanguageVoicesForScenario(
  availableVoicesByLanguage: Record<string, string>,
  scenario: ScenarioSeedRecord,
): Record<string, string> {
  const selectedLanguageIds = resolveScenarioLanguageIds(
    scenario,
    availableVoicesByLanguage,
  );

  const languageVoices: Record<string, string> = {};
  for (const languageId of selectedLanguageIds) {
    const voiceId = availableVoicesByLanguage[String(languageId)];
    if (voiceId) {
      languageVoices[String(languageId)] = voiceId;
    }
  }
  return languageVoices;
}

async function buildScenarioPayloads(
  client: AxiosInstance,
  accessToken: string,
  seedData: ScenarioPathwaySeedData,
): Promise<Array<{ seedKey: string; payload: Record<string, any> }>> {
  const availableVoicesByLanguage = await mapAvailableVoicesByLanguage(
    client,
    accessToken,
  );
  const sessionEventsByCode = await getSessionEventsByCode(client, accessToken);
  const triggerWarningsByName = await getTriggerWarningsByName(
    client,
    accessToken,
  );
  const competencyCache = new Map<string, string>();

  const allBehaviorNames = [
    ...new Set(
      seedData.scenarios.flatMap((scenario) =>
        (scenario.behaviorInstructions || []).flatMap(
          (instruction) => instruction.behaviors || [],
        ),
      ),
    ),
  ];
  const behaviorIdsByName = await getOrCreateBehaviorIdsByName(
    client,
    accessToken,
    allBehaviorNames,
  );

  return Promise.all(
    seedData.scenarios.map(async (scenario) => {
      const languageVoices = buildLanguageVoicesForScenario(
        availableVoicesByLanguage,
        scenario,
      );
      const selectedLanguageIds = Object.keys(languageVoices).map((id) =>
        Number(id),
      );

      const terminationEvents =
        scenario.terminationEvents
          ?.map((event) => {
            const resolved = sessionEventsByCode.get(event.eventCode);
            if (!resolved) {
              logStep(
                `[scenarios-pathway] Termination event code "${event.eventCode}" not found for scenario "${scenario.title}". Skipping it.`,
              );
              return null;
            }
            return {
              id: resolved.id,
              message:
                event.message || `Auto-termination event from ${resolved.name}`,
            };
          })
          .filter(Boolean) || [];

      const triggerWarningIds =
        scenario.triggerWarningNames
          ?.map((name) => {
            const id = triggerWarningsByName.get(name);
            if (!id) {
              logStep(
                `[scenarios-pathway] Trigger warning "${name}" not found for scenario "${scenario.title}". Skipping it.`,
              );
            }
            return id;
          })
          .filter((id): id is string => Boolean(id)) || [];

      const competencyId = scenario.competencyName
        ? await getOrCreateCompetencyId(
            client,
            accessToken,
            scenario.competencyName,
            competencyCache,
          )
        : undefined;

      const behaviorInstructions =
        scenario.behaviorInstructions?.map((instruction) => ({
          category: instruction.category,
          stateInstructions: instruction.stateInstructions,
          behaviors: instruction.behaviors
            .map((name) => behaviorIdsByName.get(name))
            .filter((id): id is string => Boolean(id)),
        })) || [];
      const timerSettings = normalizeTimerSettings(scenario);
      const linguisticStyleSamples = buildLinguisticStyleSamplesForScenario(
        scenario,
        selectedLanguageIds,
      );

      const payload = {
        title: scenario.title,
        description: scenario.description,
        coverImageUrl: scenario.coverImageUrl || undefined,
        coverVideoUrl: scenario.coverVideoUrl || undefined,
        status: scenario.status,
        isPublic: scenario.isPublic,
        isGlobal: scenario.isGlobal,
        prompt: scenario.prompt,
        difficultyLevel: scenario.difficultyLevel,
        responseLength: scenario.responseLength,
        name: scenario.name,
        age: scenario.age,
        gender: scenario.gender,
        genderIdentity: scenario.genderIdentity,
        sexualOrientation: scenario.sexualOrientation,
        currentLocation: scenario.currentLocation,
        profession: scenario.profession,
        personality: scenario.personality,
        tone: scenario.tone,
        openingStatements: scenario.openingStatements,
        translationOpeningStatements: scenario.translationOpeningStatements,
        languageVoices,
        linguisticStyleSamples,
        allowedFillerWords: scenario.allowedFillerWords,
        competencyId,
        terminationEvents,
        triggerWarningIds,
        customFields: scenario.customFields,
        experienceMode: scenario.experienceMode,
        checklistType: scenario.checklistType,
        timerMode: timerSettings.timerMode,
        maxTimeValue: timerSettings.maxTimeValue,
        optGuardrails: scenario.optGuardrails,
        behaviorInstructions,
        characterProfileText: scenario.characterProfileText,
        showScoreMeter: scenario.showScoreMeter,
        currentState: scenario.currentState,
        knowledgeSources: scenario.knowledgeSources,
        stateNames: scenario.stateNames || defaultStateNames(),
      };

      return {
        seedKey: scenario.seedKey,
        payload,
      };
    }),
  );
}

async function createScenarios(
  client: AxiosInstance,
  accessToken: string,
  scenarioPayloads: Array<{ seedKey: string; payload: Record<string, any> }>,
): Promise<Map<string, number>> {
  const scenarioIdBySeedKey = new Map<string, number>();

  for (const scenario of scenarioPayloads) {
    const response = await client.post(
      '/api/v1/learn/scenarios',
      { scenarios: [scenario.payload] },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    const createdScenario = response.data?.[0];
    if (createdScenario?.id) {
      scenarioIdBySeedKey.set(scenario.seedKey, createdScenario.id);
      logStep(
        `[scenarios-pathway] Created scenario ${createdScenario.title} (${createdScenario.id})`,
      );
    }
  }

  return scenarioIdBySeedKey;
}

async function assignScenariosToTenants(
  client: AxiosInstance,
  accessToken: string,
  seedData: ScenarioPathwaySeedData,
  scenarioIdBySeedKey: Map<string, number>,
): Promise<void> {
  const tenantIdsByCode = await getTenantsByCode(client, accessToken);

  for (const scenario of seedData.scenarios) {
    const scenarioId = scenarioIdBySeedKey.get(scenario.seedKey);
    if (!scenarioId || scenario.isGlobal || !scenario.tenantCodes?.length) {
      continue;
    }

    for (const tenantCode of scenario.tenantCodes) {
      const tenantId = tenantIdsByCode.get(tenantCode);
      if (!tenantId) {
        logStep(
          `[scenarios-pathway] Tenant "${tenantCode}" not found for scenario "${scenario.title}". Skipping tenant assignment.`,
        );
        continue;
      }

      await client.post(
        `/api/v1/learn/scenario/tenant/${tenantId}`,
        { scenarioIds: [scenarioId] },
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
    }
  }
}

async function createScenarioPaths(
  client: AxiosInstance,
  accessToken: string,
  paths: ScenarioPathSeedRecord[],
  scenarioIdBySeedKey: Map<string, number>,
): Promise<Map<string, string>> {
  const pathIdByTitle = new Map<string, string>();

  for (const path of paths) {
    const scenarios = path.scenarios
      .map((item) => {
        const scenarioId = scenarioIdBySeedKey.get(item.scenarioSeedKey);
        if (!scenarioId) {
          return null;
        }

        return {
          scenarioId,
          order: item.order,
          minimumScore: item.minimumScore ?? DEFAULT_PATH_MINIMUM_SCORE,
          messageTitle: item.messageTitle,
          messageContent: item.messageContent,
        };
      })
      .filter(Boolean);

    if (scenarios.length === 0) {
      logStep(
        `[scenarios-pathway] No scenarios resolved for path "${path.title}". Skipping path creation.`,
      );
      continue;
    }

    const response = await client.post(
      '/api/v1/learn/admin/scenario-paths',
      {
        title: path.title,
        description: path.description,
        coverImageUrl: path.coverImageUrl || undefined,
        isGlobal: path.isGlobal,
        status: path.status,
        scenarios,
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (response.data?.id && path.title) {
      pathIdByTitle.set(path.title, response.data.id);
      logStep(
        `[scenarios-pathway] Created scenario path ${path.title} (${response.data.id})`,
      );
    }
  }

  return pathIdByTitle;
}

async function assignPathsToTenants(
  client: AxiosInstance,
  accessToken: string,
  paths: ScenarioPathSeedRecord[],
  pathIdByTitle: Map<string, string>,
): Promise<void> {
  const tenantIdsByCode = await getTenantsByCode(client, accessToken);

  for (const path of paths) {
    if (path.isGlobal || !path.tenantCodes?.length || !path.title) {
      continue;
    }

    const pathId = pathIdByTitle.get(path.title);
    if (!pathId) {
      continue;
    }

    for (const tenantCode of path.tenantCodes) {
      const tenantId = tenantIdsByCode.get(tenantCode);
      if (!tenantId) {
        logStep(
          `[scenarios-pathway] Tenant "${tenantCode}" not found for path "${path.title}". Skipping tenant assignment.`,
        );
        continue;
      }

      await client.post(
        `/api/v1/learn/admin/scenario-paths/tenant/${tenantId}`,
        { scenarioPathIds: [pathId] },
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
    }
  }
}

async function seedScenariosAndPath() {
  logStep(`[scenarios-pathway] Connecting to API at: ${API_BASE_URL}`);

  const client = axios.create({
    baseURL: API_BASE_URL,
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  try {
    const seedData = loadScenarioSeedData();

    const { accessToken } = await login(client, adminCredentials);
    logStep('[scenarios-pathway] Admin login successful');

    const scenarioPayloads = await buildScenarioPayloads(
      client,
      accessToken,
      seedData,
    );
    const scenarioIdBySeedKey = await createScenarios(
      client,
      accessToken,
      scenarioPayloads,
    );

    await assignScenariosToTenants(
      client,
      accessToken,
      seedData,
      scenarioIdBySeedKey,
    );

    const pathIdByTitle = await createScenarioPaths(
      client,
      accessToken,
      seedData.paths,
      scenarioIdBySeedKey,
    );
    await assignPathsToTenants(
      client,
      accessToken,
      seedData.paths,
      pathIdByTitle,
    );

    logStep('[scenarios-pathway] ✅ Scenario seeding completed successfully!');
  } catch (error: any) {
    const detail =
      error.response?.data?.message ??
      JSON.stringify(error.response?.data) ??
      error.message;
    console.error('[scenarios-pathway] ❌ Error during seeding:', detail);
    process.exit(1);
  }
}

seedScenariosAndPath();
