import axios, { AxiosInstance } from 'axios';
import { config } from 'dotenv';

config();

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

// Admin credentials for authentication
const adminCredentials = {
  username: 'admin@example.com',
  password: 'Password123!',
};

// Voice to create
const voiceData = {
  voices: [
    {
      name: 'Default Seed Voice',
      provider: 'OpenAI',
      config: {
        voiceId: 'alloy',
        model: 'tts-1',
      },
      languageId: 1,
    },
  ],
};

// Function to create scenarios data with voiceId
const createScenariosData = (voiceId: string) => ({
  scenarios: [
    {
      title: 'Introduction to Active Listening',
      description:
        'Learn the fundamentals of active listening in a counseling session.',
      status: 'ACTIVE',
      name: 'Alex',
      age: 25,
      gender: 'male',
      genderIdentity: 'Male/Man',
      sexualOrientation: 'Heterosexual (straight)',
      currentLocation: 'New York, USA',
      personality: 'Introverted, thoughtful, slightly anxious',
      context:
        'Alex is a young professional struggling with work-life balance and seeking guidance.',
      prompt:
        'You are Alex, a 25-year-old software developer feeling overwhelmed at work.',
      difficultyLevel: 'EASY',
      responseLength: 'BRIEF',
      tone: 'Casual',
      openingStatements: [
        "Hi, I'm not really sure where to start...",
        "I've been feeling really stressed lately.",
      ],
      agentDialogues: [
        'I understand',
        'Tell me more',
        'How does that make you feel?',
      ],
      coverImageUrl: 'https://placehold.co/400x300/png?text=Scenario+1',
      voiceId,
      languageVoices: { 1: voiceId },
    },
    {
      title: 'Handling Emotional Disclosure',
      description:
        'Practice responding to emotional disclosures with empathy and support.',
      status: 'ACTIVE',
      name: 'Maya',
      age: 32,
      gender: 'female',
      genderIdentity: 'Female/Woman',
      sexualOrientation: 'Heterosexual (straight)',
      currentLocation: 'Los Angeles, USA',
      personality: 'Expressive, emotional, seeking validation',
      context:
        'Maya recently experienced a significant loss and is processing grief.',
      prompt:
        'You are Maya, a 32-year-old teacher dealing with the loss of a close family member.',
      difficultyLevel: 'MEDIUM',
      responseLength: 'MEDIUM',
      tone: 'Emotional',
      openingStatements: [
        "I don't know if I can do this...",
        "It's been really hard since my mother passed away.",
      ],
      agentDialogues: [
        "I'm here for you",
        'Take your time',
        'That sounds difficult',
      ],
      coverImageUrl: 'https://placehold.co/400x300/png?text=Scenario+2',
      voiceId,
      languageVoices: { 1: voiceId },
    },
  ],
});

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
    if (response.data?.data?.length > 0) {
      const voice = response.data.data[0];
      console.log(`Using existing voice: ${voice.name} (${voice.id})`);
      return voice.id;
    }
  } catch (error: any) {
    console.log('No existing voices found, creating new one...');
  }

  // Create a new voice
  try {
    const response = await client.post(
      '/api/v1/learn/scenarios/voices',
      voiceData,
      { headers },
    );
    const voice = response.data[0];
    console.log(`Created voice: ${voice.name} (${voice.id})`);
    return voice.id;
  } catch (error: any) {
    console.error(
      'Failed to create voice:',
      error.response?.data?.message || error.message,
    );
    throw error;
  }
}

async function createScenarios(
  client: AxiosInstance,
  accessToken: string,
  voiceId: string,
): Promise<number[]> {
  try {
    const scenariosData = createScenariosData(voiceId);
    const response = await client.post(
      '/api/v1/learn/scenarios',
      scenariosData,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    const scenarioIds = response.data.map((scenario: any) => scenario.id);
    console.log(`Created ${scenarioIds.length} scenarios:`);
    response.data.forEach((scenario: any) => {
      console.log(`  - ${scenario.title} (ID: ${scenario.id})`);
    });

    return scenarioIds;
  } catch (error: any) {
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

seedScenariosAndPath();
