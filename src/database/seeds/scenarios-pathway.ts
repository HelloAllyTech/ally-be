import axios, { AxiosInstance } from 'axios';
import { config } from 'dotenv';
import {
  ScenarioDifficultyLevel,
  ScenarioStatus,
} from 'src/learn/type/scenario.type';

type SeedScenario = {
  title: string;
  description: string;
  status: ScenarioStatus;
  difficultyLevel: ScenarioDifficultyLevel;
  responseLength: string;
  isGlobal: boolean;
  metadata: Record<string, any>;
  terminationEvents: {
    id: string;
    message: string;
  }[];
  triggerWarningNames: string[];
};

config();

const API_BASE_URL = 'http://localhost:8001';

// Admin credentials for authentication
const adminCredentials = {
  username: 'admin@example.com',
  password: 'Password123!',
};

// Function to create scenarios data with voiceId
const createScenariosData = async (
  voiceId: string,
  client: AxiosInstance,
  accessToken: string,
) => {
  const langaugesVoices = await mapLanguagesVoices(client, accessToken);

  const scenarios = [
    {
      title: 'Active Listening Basics',
      description:
        'Practice listening skills with Alex, a young professional feeling overwhelmed.',
      status: ScenarioStatus.ACTIVE,
      difficultyLevel: ScenarioDifficultyLevel.EASY,
      responseLength: 'BRIEF',
      isGlobal: true,
      coverImageUrl: 'https://placehold.co/400x300/png?text=Active+Listening',
      name: 'Active Listening Basics',
      age: 25,
      gender: 'male',
      currentLocation: 'Kolkata, India',
      prompt:
        'You are Alex, a 25-year-old professional feeling overwhelmed with work. Share your feelings openly.',
      genderIdentity: 'Male/Man',
      sexualOrientation: 'Heterosexual (straight)',
      context: 'Struggling with work-life balance and stress',
      metadata: {
        name: 'Alex',
        age: 25,
        gender: 'male',
        genderIdentity: 'Male/Man',
        sexualOrientation: 'Heterosexual (straight)',
        currentLocation: 'New York, USA',
        profession: 'Software Developer',
        context: 'Struggling with work-life balance and stress',
        tone: 'Cautious but hopeful',
        openingStatements: [
          "I'm not sure where to start...",
          "Everything feels like it's piling up.",
        ],
        agentDialogues: ['I hear you', 'Tell me more', 'That sounds tough'],
        prompt:
          'You are Alex, a 25-year-old professional feeling overwhelmed with work. Share your feelings openly.',
        voiceId,
        langaugesVoices,
      },
      terminationEvents: [
        {
          id: 'event-active-listening-success',
          message: 'Great job practicing active listening!',
        },
      ],
      triggerWarningNames: ['Stress & Anxiety'],
    },
    {
      title: 'Supporting Emotional Disclosure',
      description: 'Respond empathetically as Maya processes her grief.',
      status: ScenarioStatus.ACTIVE,
      difficultyLevel: ScenarioDifficultyLevel.MEDIUM,
      responseLength: 'MEDIUM',
      isGlobal: true,
      metadata: {
        name: 'Maya',
        age: 32,
        gender: 'female',
        genderIdentity: 'Female/Woman',
        sexualOrientation: 'Heterosexual (straight)',
        currentLocation: 'Los Angeles, USA',
        profession: 'Teacher',
        context: 'Recently lost a close family member',
        tone: 'Emotional',
        openingStatements: [
          "It's been really hard since my mother passed away.",
          "I don't know how to hold everything together anymore.",
        ],
        agentDialogues: [
          'I’m here for you.',
          'Take your time.',
          'That sounds incredibly difficult.',
        ],
        prompt:
          'You are Maya, a 32-year-old grieving the loss of your mother. You’re seeking support and validation.',
        voiceId,
        langaugesVoices,
      },
      terminationEvents: [
        {
          id: 'event-emotional-support-success',
          message: 'You navigated emotional disclosure with empathy!',
        },
      ],
      triggerWarningNames: ['Grief & Loss'],
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
  isGlobal: false,
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
    console.log('Login successful');
    return {
      accessToken: response.data.accessToken,
      refreshToken: response.data.refreshToken,
    };
  } catch (error: any) {
    console.error(
      'Login failed:',
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
    console.log(`Using existing voice: ${voice.name} (${voice.id})`);
    return voice.id;
  } catch (error: any) {
    console.log('No existing voices found, creating new one...');
    throw error;
  }
}

async function createScenarios(
  client: AxiosInstance,
  accessToken: string,
  voiceId: string,
): Promise<number[]> {
  try {
    const scenariosData: SeedScenario[] = await createScenariosData(
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

    console.log(response, 'response');

    const scenarioIds = response.data.map((scenario: any) => scenario.id);
    console.log(`Created ${scenarioIds.length} scenarios:`);
    response.data.forEach((scenario: any) => {
      console.log(`  - ${scenario.title} (ID: ${scenario.id})`);
    });

    return scenarioIds;
  } catch (error: any) {
    console.log(error, 'error');
    console.error(
      'Failed to create scenarios:',
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

    console.log(
      `Created scenario path: ${pathData.title} (ID: ${response.data.id})`,
    );
  } catch (error: any) {
    console.error(
      'Failed to create scenario path:',
      error.response?.data?.message || error.message,
    );
    throw error;
  }
}

async function seedScenariosAndPath() {
  console.log(`Connecting to API at: ${API_BASE_URL}`);

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

    // Create scenario path with the created scenarios
    await createScenarioPath(client, accessToken, scenarioIds);

    console.log('---');
    console.log('Seeding completed successfully!');
  } catch (error: any) {
    console.error('Error during seeding:', error.message);
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
    const uniqueLangauges = new Set(
      response.data.map((voice: any) => voice.languageId),
    );

    const langaugesVoices: Record<string, string> = {};
    uniqueLangauges.forEach((languageId: any) => {
      const voiceForLanguage = response.data.find(
        (voice: any) => voice.languageId === languageId,
      );
      if (voiceForLanguage) {
        langaugesVoices[languageId] = voiceForLanguage.id;
      }
    });

    console.log(`Got the available language voices: `, langaugesVoices);
    return langaugesVoices;
  } catch (error: any) {
    console.log('No existing voices found, creating new one...');
    throw error;
  }
}

seedScenariosAndPath();
