import axios, { AxiosInstance } from 'axios';
import { config } from 'dotenv';
import { logStep } from './seed-utils';
import {
  ScenarioDifficultyLevel,
  ScenarioResponseLength,
  ScenarioStatus,
} from 'src/learn/type/scenario.type';

type TriggerWarnings = {
  createdAt: string;
  updatedAt: string;
  id: string;
  name: string;
};

config();

const API_BASE_URL = 'http://localhost:8001';

// Admin credentials for authentication
const adminCredentials = {
  username: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
  password: process.env.SEED_ADMIN_PASSWORD || 'Password123!',
};

// Shared prompt template for scenarios
const SHARED_PROMPT = `You are an AI roleplay assistant for counselor training. In this simulation, you must act ONLY as the client in a therapy session. Stay fully in character, provide realistic dialogue, and do not switch roles unless explicitly instructed.

Important Instructions:
- Prefer first-person phrasing (e.g., "I feel...", "I have been struggling with...").
- Allow the counselor to guide the conversation.
- If the counselor is silent or open-ended, share one thought, feeling, or small story, then stop.
- Maintain consistency with your life history but allow natural variation in tone and detail.
- Respond naturally, as a real client would.
- Keep answers concise (2-6 sentences), unless a longer response is natural.
- Reveal information gradually, not all at once.
- Start with few details and open up more as the counselor asks questions.
- Show authentic emotions and natural hesitations.
- Do not give therapy advice or act as the counselor.
- If sensitive topics arise, respond realistically but without graphic detail.
- Keep each reply under ~120 words.`;

// Function to create scenarios data with voiceId
const createScenariosData = async (
  voiceId: string,
  client: AxiosInstance,
  accessToken: string,
) => {
  const languageVoices = await mapLanguagesVoices(client, accessToken);
  const { terminationEventId, terminationMessage } =
    await getTerminationEventData(client, accessToken);

  const triggerWarningIds = await getTriggerWarnings(client, accessToken);

  const scenarios = [
    {
      isGlobal: true,
      title: 'Active Listening Basics',
      coverImageUrl: 'https://placehold.co/400x300/png?text=Active+Listening',
      coverVideoUrl: null,
      description:
        'Practice listening skills with Alex, a young professional feeling overwhelmed.',
      difficultyLevel: ScenarioDifficultyLevel.EASY,
      status: ScenarioStatus.ACTIVE,
      responseLength: ScenarioResponseLength.VERY_BRIEF,
      // Client profile (shown to counselor)
      name: 'Alex Johnson',
      age: 25,
      gender: 'male',
      genderIdentity: 'Male/Man',
      sexualOrientation: 'Heterosexual (straight)',
      profession: 'Software Engineer',
      currentLocation: 'Kochi, India',
      context: 'Struggling with work-life balance and stress',
      tone: 'Casual',
      // Voice and dialogue
      voiceId,
      languageVoices,
      prompt: SHARED_PROMPT,
      openingStatements: [
        'I am not sure where to start...',
        'Everything feels like it is piling up.',
      ],
      agentDialogues: ['I hear you', 'Tell me more', 'That sounds tough'],
      // Termination settings
      autoTerminationStatus: true,
      terminationEventId,
      terminationMessage,
      triggerWarningIds,
    },
    {
      isGlobal: true,
      title: 'Managing Workplace Anxiety',
      coverImageUrl: 'https://placehold.co/400x300/png?text=Workplace+Anxiety',
      coverVideoUrl: null,
      description:
        'Practice empathetic responses with Priya, a mid-level professional experiencing anxiety at work.',
      difficultyLevel: ScenarioDifficultyLevel.MEDIUM,
      status: ScenarioStatus.ACTIVE,
      responseLength: ScenarioResponseLength.VERY_BRIEF,
      // Client profile (shown to counselor)
      name: 'Priya Nair',
      age: 29,
      gender: 'female',
      genderIdentity: 'Female/Woman',
      sexualOrientation: 'Heterosexual (straight)',
      profession: 'Product Manager',
      currentLocation: 'Bengaluru, India',
      context:
        'Experiencing anxiety due to high expectations and fear of underperforming at work',
      tone: 'Thoughtful',
      // Voice and dialogue
      voiceId,
      languageVoices,
      prompt: SHARED_PROMPT,
      openingStatements: [
        'I have been feeling on edge at work lately.',
        'Even small tasks are starting to feel stressful.',
      ],
      agentDialogues: [
        'That sounds overwhelming.',
        'Can you tell me more about that?',
        'I am listening.',
      ],
      // Termination settings
      autoTerminationStatus: false,
      triggerWarningIds,
    },
  ];

  return scenarios;
};

// Scenario path configuration (will be populated with created scenario IDs)
const createScenarioPathData = (scenarioIds: number[]) => ({
  title: 'Counseling Fundamentals Path',
  description:
    'A learning path covering basic counseling skills from active listening to handling emotional situations.',
  status: 'ACTIVE',
  isGlobal: true,
  coverImageUrl: 'https://placehold.co/400x300/png?text=Learning+Path',
  scenarios: scenarioIds.map((scenarioId, index) => ({
    scenarioId,
    order: index + 1,
    minimumScore: 70,
    messageTitle: index === 0 ? 'Great Start!' : 'Well Done!',
    messageContent:
      index === 0
        ? 'You have completed the first scenario. Keep going!'
        : 'Congratulations on completing this scenario!',
  })),
});

async function login(
  client: AxiosInstance,
): Promise<{ accessToken: string; refreshToken: string }> {
  try {
    const response = await client.post('/api/v1/auth/login', adminCredentials);
    logStep('[scenarios-pathway] Login successful');
    return {
      accessToken: response.data.accessToken,
      refreshToken: response.data.refreshToken,
    };
  } catch (error: any) {
    console.error(
      '[scenarios-pathway] Login failed:',
      error.response?.data?.message || error.message,
    );
    throw error;
  }
}

async function getOrCreateVoice(
  client: AxiosInstance,
  accessToken: string,
): Promise<string> {
  const headers = { Authorization: `Bearer ${accessToken}` };

  // Try to get existing voices first
  try {
    const response = await client.get('/api/v1/learn/scenario-voices', {
      headers,
    });
    const voice = response.data[0];
    logStep(
      `[scenarios-pathway] Using existing voice: ${voice.name} (${voice.id})`,
    );
    return voice.id;
  } catch (error: any) {
    logStep('[scenarios-pathway] No existing voices found');
    throw error;
  }
}

async function createScenarios(
  client: AxiosInstance,
  accessToken: string,
  voiceId: string,
): Promise<number[]> {
  try {
    const scenariosData: any[] = await createScenariosData(
      voiceId,
      client,
      accessToken,
    );

    const response = await client.post(
      '/api/v1/learn/scenarios',
      { scenarios: scenariosData },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    const scenarioIds = response.data.map((scenario: any) => scenario.id);
    logStep(`[scenarios-pathway] Created ${scenarioIds.length} scenarios:`);
    response.data.forEach((scenario: any) => {
      logStep(`[scenarios-pathway]   ✓ ${scenario.title} (ID: ${scenario.id})`);
    });

    return scenarioIds;
  } catch (error: any) {
    console.error(
      '[scenarios-pathway] Failed to create scenarios:',
      error.response?.data?.message || error.message,
    );
    throw error;
  }
}

async function createScenarioPath(
  client: AxiosInstance,
  accessToken: string,
  scenarioIds: number[],
): Promise<void> {
  try {
    const pathData = createScenarioPathData(scenarioIds);
    const response = await client.post(
      '/api/v1/learn/admin/scenario-paths',
      pathData,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    logStep(
      `[scenarios-pathway] Created scenario path: ${pathData.title} (ID: ${response.data.id})`,
    );
  } catch (error: any) {
    console.error(
      '[scenarios-pathway] Failed to create scenario path:',
      error.response?.data?.message || error.message,
    );
    throw error;
  }
}

async function seedScenariosAndPath() {
  logStep(`[scenarios-pathway] Connecting to API at: ${API_BASE_URL}`);

  const client = axios.create({
    baseURL: API_BASE_URL,
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  try {
    // Login to get access token
    const { accessToken } = await login(client);

    // Get or create a voice
    const voiceId = await getOrCreateVoice(client, accessToken);

    // Create scenarios with the voice ID
    const scenarioIds = await createScenarios(client, accessToken, voiceId);

    // Create scenario path
    await createScenarioPath(client, accessToken, scenarioIds);

    logStep('[scenarios-pathway] ✅ Scenario seeding completed successfully!');
  } catch (error: any) {
    console.error(
      '[scenarios-pathway] ❌ Error during seeding:',
      error.message,
    );
    process.exit(1);
  }
}

async function mapLanguagesVoices(
  client: AxiosInstance,
  accessToken: string,
): Promise<Record<string, string>> {
  const headers = { Authorization: `Bearer ${accessToken}` };

  // Try to get existing voices first
  try {
    const response = await client.get('/api/v1/learn/scenario-voices', {
      headers,
    });
    const uniqueLanguages = new Set(
      response.data.map((voice: any) => voice.languageId),
    );

    const languageVoices: Record<string, string> = {};
    uniqueLanguages.forEach((languageId: any) => {
      const voiceForLanguage = response.data.find(
        (voice: any) => voice.languageId === languageId,
      );
      if (voiceForLanguage) {
        languageVoices[languageId] = voiceForLanguage.id;
      }
    });

    logStep(
      `[scenarios-pathway] Got available language voices: ${Object.keys(languageVoices).length}`,
    );
    return languageVoices;
  } catch (error: any) {
    logStep('[scenarios-pathway] No existing voices found');
    throw error;
  }
}

async function getTerminationEventData(
  client: AxiosInstance,
  accessToken: string,
): Promise<{ terminationEventId: string; terminationMessage: string }> {
  const headers = { Authorization: `Bearer ${accessToken}` };

  try {
    const response = await client.get(
      '/api/v1/session-events?offset=0&limit=1&searchName=',
      {
        headers,
      },
    );

    if (response.data.data.length === 0) {
      throw new Error('No session events found');
    }
    const terminationEvent = response.data.data[0];

    if (!terminationEvent) {
      throw new Error('Termination event not found');
    }

    logStep(
      `[scenarios-pathway] Found termination event: ${terminationEvent.name}`,
    );

    return {
      terminationEventId: terminationEvent.id,
      terminationMessage: 'Your problem is important to me.',
    };
  } catch (error: any) {
    console.error(
      '[scenarios-pathway] Failed to fetch termination events:',
      error.response?.data?.message || error.message,
    );
    throw error;
  }
}

async function getTriggerWarnings(
  client: AxiosInstance,
  accessToken: string,
): Promise<string[]> {
  const headers = { Authorization: `Bearer ${accessToken}` };

  try {
    const response = await client.get(
      '/api/v1/learn/trigger-warnings?name=&offset=0&limit=20',
      {
        headers,
      },
    );

    if (response.data.length === 0) {
      logStep('[scenarios-pathway] No trigger warnings found');
      return [];
    }

    const triggerWarnings = response.data;

    const triggerWarningIds = triggerWarnings.map(
      (tw: TriggerWarnings) => tw.id,
    );
    logStep(
      `[scenarios-pathway] Fetched ${triggerWarningIds.length} trigger warnings`,
    );
    return triggerWarningIds;
  } catch (error: any) {
    console.error(
      '[scenarios-pathway] Failed to fetch trigger warnings:',
      error.response?.data?.message || error.message,
    );
    throw error;
  }
}

seedScenariosAndPath();
