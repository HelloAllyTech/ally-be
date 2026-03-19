/**
 * Comprehensive seed script for scenario sessions.
 *
 * This script:
 * 1. Creates or uses an existing counselor user
 * 2. Creates or uses an existing scenario
 * 3. Creates 2 scenario sessions with all related data:
 *    - Scenario session messages (transcript)
 *    - Scenario session details (summary)
 *    - Scenario session events (optional)
 *    - Scenario session chat (for v2 API testing)
 *
 * Usage:
 *   npm run seed -- src/database/seeds/seed-scenario-session.ts
 *
 * Environment variables:
 *   SEED_ADMIN_EMAIL - Admin email (default: admin@example.com)
 *   SEED_ADMIN_PASSWORD - Admin password (default: Password123!)
 *   API_BASE_URL - API base URL (default: http://localhost:8001)
 *   DEFAULT_TENANT_CODE - Default tenant code (default: ally)
 */

import axios, { AxiosInstance } from 'axios';
import { config } from 'dotenv';
import { logStep } from './seed-utils';
import { createSeedDataSource, DEFAULT_TENANT_CODE_ENV } from './seed-utils';
import { ScenarioSessions } from '../../learn/entity/scenario-sessions.entity';
import { ScenarioSessionMessages } from '../../learn/entity/scenario-session-messages.entity';
import { ScenarioSessionDetails } from '../../learn/entity/scenario-session-details.entity';
import { ScenarioSessionEvents } from '../../learn/entity/scenario-session-events.entity';
import { ScenarioSessionChat } from '../../learn/entity/scenario-session-chat.entity';
import { ScenarioSessionChatMessage } from '../../learn/entity/scenario-session-chat-message.entity';
import { ScenarioSessionMessageType } from '../../learn/enum/scenario-session-message.type.enum';
import { ScenarioSessionStatus } from '../../learn/enum/scenario-session-status.enum';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { UserRole } from '../../common/constants/user.constants';

config();

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8001';

// Admin credentials for authentication
const adminCredentials = {
  username: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
  password: process.env.SEED_ADMIN_PASSWORD || 'Password123!',
};

// Default counselor user data
const counselorData = {
  email: 'test-learner@example.com',
  name: 'Test Learer',
  roles: [UserRole.LEARNER],
  password: 'Password123!',
};

// Default scenario data
const defaultScenarioData = {
  title: 'Active Listening Practice',
  description:
    'Practice active listening skills with a client dealing with work stress',
  status: 'ACTIVE',
  difficultyLevel: 'EASY',
  responseLength: 'VERY_BRIEF',
  isGlobal: true,
};

/**
 * Login and get access token
 */
async function login(
  client: AxiosInstance,
): Promise<{ accessToken: string; refreshToken: string }> {
  try {
    const response = await client.post('/api/v1/auth/login', adminCredentials);
    logStep('Login successful');
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

/**
 * Get or create tenant
 */
async function getOrCreateTenant(
  client: AxiosInstance,
  accessToken: string,
): Promise<string> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const tenantCode = DEFAULT_TENANT_CODE_ENV;

  // Try to get tenant by code
  try {
    const response = await client.get(`/api/v1/tenants/code/${tenantCode}`, {
      headers,
    });
    if (response.data?.id) {
      logStep(`Found existing tenant: ${tenantCode} (${response.data.id})`);
      return response.data.id;
    }
  } catch (error: any) {
    if (error.response?.status !== 404) {
      logStep(`Tenant lookup returned: ${error.response?.status}`);
    }
  }

  // Create tenant if not found
  try {
    const response = await client.post(
      '/api/v1/tenants',
      {
        name: 'Ally Test Tenant',
        code: tenantCode,
        description: 'Default tenant for seeding',
      },
      { headers },
    );
    logStep(`Created tenant: ${tenantCode} (${response.data.id})`);
    return response.data.id;
  } catch (error: any) {
    if (error.response?.data?.message?.includes('already exists')) {
      const listResponse = await client.get('/api/v1/tenants', { headers });
      const tenant = listResponse.data?.data?.find(
        (t: any) => t.code === tenantCode,
      );
      if (tenant) {
        logStep(`Found tenant in list: ${tenantCode} (${tenant.id})`);
        return tenant.id;
      }
    }
    console.error(
      'Failed to create/find tenant:',
      error.response?.data?.message || error.message,
    );
    throw error;
  }
}

/**
 * Get or create counselor user
 */
async function getOrCreateCounselor(
  client: AxiosInstance,
  accessToken: string,
  tenantId: string,
): Promise<number> {
  const headers = { Authorization: `Bearer ${accessToken}` };

  // Try to find existing counselor
  try {
    const response = await client.get('/api/v1/users', {
      headers,
      params: {
        search: counselorData.email,
        roles: UserRole.COUNSELOR,
      },
    });

    const users = response.data?.data || response.data || [];
    const existingCounselor = users.find(
      (user: any) => user.email === counselorData.email,
    );

    if (existingCounselor) {
      logStep(
        `Found existing counselor: ${counselorData.email} (ID: ${existingCounselor.id})`,
      );
      return existingCounselor.id;
    }
  } catch (error) {
    logStep(`Error searching for counselor, will create new one ${error}`);
  }

  // Create counselor if not found
  try {
    const response = await client.post(
      '/api/v1/users',
      {
        ...counselorData,
        tenantId,
      },
      { headers },
    );
    logStep(
      `Created counselor: ${counselorData.email} (ID: ${response.data.id})`,
    );
    return response.data.id;
  } catch (error: any) {
    if (error.response?.status === 400) {
      // User might already exist, try to find it
      const listResponse = await client.get('/api/v1/users', {
        headers,
        params: { search: counselorData.email },
      });
      const users = listResponse.data?.data || listResponse.data || [];
      const user = users.find((u: any) => u.email === counselorData.email);
      if (user) {
        logStep(`Found counselor after creation attempt: ${user.id}`);
        return user.id;
      }
    }
    console.error(
      'Failed to create/find counselor:',
      error.response?.data?.message || error.message,
    );
    throw error;
  }
}

/**
 * Get or create scenario
 */
async function getOrCreateScenario(
  client: AxiosInstance,
  accessToken: string,
): Promise<number> {
  const headers = { Authorization: `Bearer ${accessToken}` };

  // Try to get existing scenarios
  try {
    const response = await client.get('/api/v1/learn/scenarios', {
      headers,
      params: { limit: 10 },
    });

    const scenarios = response.data?.data || response.data || [];
    if (scenarios.length > 0) {
      const scenario = scenarios[0];
      logStep(
        `Using existing scenario: ${scenario.title} (ID: ${scenario.id})`,
      );
      return scenario.id;
    }
  } catch (error) {
    logStep(`Error fetching scenarios, will create new one ${error}`);
  }

  // Get voice ID first (required for scenario creation)
  let voiceId: string;
  try {
    const voiceResponse = await client.get('/api/v1/learn/scenario-voices', {
      headers,
    });
    const voices = voiceResponse.data || [];
    if (voices.length > 0) {
      voiceId = voices[0].id;
      logStep(`Using existing voice: ${voices[0].name} (${voiceId})`);
    } else {
      throw new Error('No voices found. Please seed voices first.');
    }
  } catch (error: any) {
    console.error('Failed to get voice:', error.message);
    throw new Error(
      'No voices available. Please run: npm run seed:voices first.',
    );
  }

  // Create scenario
  try {
    const scenarioPayload = {
      ...defaultScenarioData,
      voiceId,
      languageVoices: { '1': voiceId },
      prompt:
        'You are an AI roleplay assistant for counselor training. Act as the client in a therapy session.',
      name: 'Alex Johnson',
      age: 25,
      gender: 'male',
      openingStatements: ['I am not sure where to start...'],
    };

    const response = await client.post(
      '/api/v1/learn/scenarios',
      { scenarios: [scenarioPayload] },
      { headers },
    );

    const scenario = Array.isArray(response.data)
      ? response.data[0]
      : response.data;
    logStep(`Created scenario: ${scenario.title} (ID: ${scenario.id})`);
    return scenario.id;
  } catch (error: any) {
    console.error(
      'Failed to create scenario:',
      error.response?.data?.message || error.message,
    );
    throw error;
  }
}

/**
 * Creates scenario session with all related data
 */
async function createScenarioSession(
  dataSource: DataSource,
  scenarioId: number,
  counselorId: number,
  tenantId: string,
  sessionNumber: number,
): Promise<string> {
  const sessionRepo = dataSource.getRepository(ScenarioSessions);
  const roomId = `room-${randomUUID()}`;
  const startedAt = new Date(Date.now() - 3600000 * sessionNumber); // Stagger start times
  const callDuration = 300 + Math.floor(Math.random() * 120); // 5-7 minutes
  const endedAt = new Date(startedAt.getTime() + callDuration * 1000);

  // Create scenario session
  const scenarioSession = sessionRepo.create({
    roomId,
    scenarioId,
    counselorId,
    tenantId,
    status: ScenarioSessionStatus.ENDED,
    startedAt,
    endedAt,
    score: Math.floor(Math.random() * 30) + 70, // Random score 70-100
    metadata: {
      languageId: 1,
    },
  });

  const savedSession = await sessionRepo.save(scenarioSession);
  logStep(
    `[Session ${sessionNumber}] Created scenario session: ${savedSession.id}`,
  );

  // Create messages (transcript)
  await createScenarioSessionMessages(
    dataSource,
    savedSession.id,
    counselorId,
    tenantId,
    callDuration,
    sessionNumber,
  );

  // Create details (summary)
  await createScenarioSessionDetails(
    dataSource,
    savedSession.id,
    tenantId,
    callDuration,
    sessionNumber,
  );

  // Create events
  await createScenarioSessionEvents(
    dataSource,
    savedSession.id,
    tenantId,
    callDuration,
    sessionNumber,
  );

  // Create chat (for v2 API)
  await createScenarioSessionChat(
    dataSource,
    savedSession.id,
    counselorId,
    tenantId,
    sessionNumber,
  );

  return savedSession.id;
}

/**
 * Creates sample transcript messages
 */
async function createScenarioSessionMessages(
  dataSource: DataSource,
  scenarioSessionId: string,
  counselorId: number,
  tenantId: string,
  callDuration: number,
  sessionNumber: number,
): Promise<void> {
  const messageRepo = dataSource.getRepository(ScenarioSessionMessages);

  // Different conversation for each session
  const conversations = [
    [
      {
        senderId: -1,
        content:
          "Hi, thank you for seeing me today. I've been feeling really overwhelmed lately.",
        startSeconds: 5,
        endSeconds: 12,
      },
      {
        senderId: counselorId,
        content:
          "I'm glad you came in. Can you tell me more about what's been making you feel overwhelmed?",
        startSeconds: 15,
        endSeconds: 22,
      },
      {
        senderId: -1,
        content:
          "It's work mostly. I've been working 12-hour days and I can't seem to catch up.",
        startSeconds: 25,
        endSeconds: 35,
      },
      {
        senderId: counselorId,
        content:
          'That sounds really challenging. How long has this been going on?',
        startSeconds: 38,
        endSeconds: 45,
      },
      {
        senderId: -1,
        content:
          "About three months now. I thought it would get better, but it's only gotten worse.",
        startSeconds: 48,
        endSeconds: 58,
      },
      {
        senderId: counselorId,
        content:
          'I can see that this is really affecting you. Your feelings are completely valid.',
        startSeconds: 60,
        endSeconds: 68,
      },
      {
        senderId: -1,
        content:
          "It's just... it feels so heavy, you know? Like I'm carrying everything.",
        startSeconds: 72,
        endSeconds: 82,
      },
      {
        senderId: counselorId,
        content:
          "Let's start small. What's one thing you could try this week to help manage the stress?",
        startSeconds: 85,
        endSeconds: 95,
      },
    ],
    [
      {
        senderId: -1,
        content:
          "I'm not sure if I should be here. I don't really like talking about my problems.",
        startSeconds: 3,
        endSeconds: 10,
      },
      {
        senderId: counselorId,
        content:
          'I understand that can be difficult. It takes courage to come here. What made you decide to come today?',
        startSeconds: 13,
        endSeconds: 22,
      },
      {
        senderId: -1,
        content:
          "My friend said I should. I guess things have been getting worse and I don't know what else to do.",
        startSeconds: 25,
        endSeconds: 35,
      },
      {
        senderId: counselorId,
        content:
          "It sounds like things have been really hard for you. Can you tell me more about what's been getting worse?",
        startSeconds: 38,
        endSeconds: 48,
      },
      {
        senderId: -1,
        content:
          "I've been having trouble sleeping. I lie awake thinking about everything I need to do.",
        startSeconds: 52,
        endSeconds: 62,
      },
      {
        senderId: counselorId,
        content:
          'That must be exhausting. How long have you been having trouble sleeping?',
        startSeconds: 65,
        endSeconds: 73,
      },
      {
        senderId: -1,
        content: 'Maybe a month or two. I just feel so tired all the time.',
        startSeconds: 76,
        endSeconds: 84,
      },
      {
        senderId: counselorId,
        content:
          'I hear you. Sleep issues can really impact everything else. What do you think might be contributing to the trouble sleeping?',
        startSeconds: 87,
        endSeconds: 98,
      },
    ],
  ];

  const messages = conversations[sessionNumber - 1] || conversations[0];

  const messageEntities = messages.map((msg) =>
    messageRepo.create({
      scenarioSessionId,
      senderId: msg.senderId,
      messageType: ScenarioSessionMessageType.TEXT,
      content: msg.content,
      startSeconds: msg.startSeconds,
      endSeconds: msg.endSeconds,
      tenantId,
    }),
  );

  await messageRepo.save(messageEntities);
  logStep(
    `[Session ${sessionNumber}] Created ${messageEntities.length} scenario session messages`,
  );
}

/**
 * Creates scenario session details with summary
 */
async function createScenarioSessionDetails(
  dataSource: DataSource,
  scenarioSessionId: string,
  tenantId: string,
  callDuration: number,
  sessionNumber: number,
): Promise<void> {
  const detailsRepo = dataSource.getRepository(ScenarioSessionDetails);

  const summaries = [
    {
      strengths: [
        'Demonstrated active listening by asking follow-up questions',
        'Validated client feelings effectively',
        'Used open-ended questions to explore the issue',
      ],
      areasForImprovement: [
        'Could have explored emotional impact more deeply',
        'Moved to solutions quickly - could have held space longer',
      ],
      keyTopics: ['Work stress', 'Work-life balance', 'Overwhelm'],
      techniquesUsed: [
        'Active listening',
        'Validation',
        'Open-ended questions',
      ],
      overallAssessment:
        "The counselor showed good foundational skills in active listening and validation. The session established rapport and began exploring the client's concerns about work-related stress.",
    },
    {
      strengths: [
        'Acknowledged client resistance respectfully',
        'Explored underlying concerns about therapy',
        'Maintained non-judgmental stance',
      ],
      areasForImprovement: [
        'Could explore sleep patterns in more detail',
        'Might benefit from more specific questions about triggers',
      ],
      keyTopics: ['Resistance to therapy', 'Sleep issues', 'Fatigue'],
      techniquesUsed: ['Normalization', 'Exploration', 'Empathetic responses'],
      overallAssessment:
        'The counselor handled client resistance well by acknowledging it and exploring the underlying concerns. Good use of normalization and exploration techniques.',
    },
  ];

  const summary = summaries[sessionNumber - 1] || summaries[0];

  const details = detailsRepo.create({
    scenarioSessionId,
    tenantId,
    callDuration,
    summary,
  });

  await detailsRepo.save(details);
  logStep(`[Session ${sessionNumber}] Created scenario session details`);
}

/**
 * Creates sample scenario session events
 */
async function createScenarioSessionEvents(
  dataSource: DataSource,
  scenarioSessionId: string,
  tenantId: string,
  callDuration: number,
  sessionNumber: number,
): Promise<void> {
  const eventsRepo = dataSource.getRepository(ScenarioSessionEvents);

  const events = [
    {
      eventId: `event-${sessionNumber}-1`,
      occurredAt: new Date(Date.now() - callDuration * 1000 + 30 * 1000),
      score: 8,
      emoji: '👍',
      message: 'Good use of validation',
      metadata: { type: 'positive_feedback' },
    },
    {
      eventId: `event-${sessionNumber}-2`,
      occurredAt: new Date(Date.now() - callDuration * 1000 + 90 * 1000),
      score: 7,
      emoji: '💡',
      message: 'Consider exploring emotions deeper',
      metadata: { type: 'suggestion' },
    },
  ];

  const eventEntities = events.map((event) =>
    eventsRepo.create({
      scenarioSessionId,
      tenantId,
      ...event,
    }),
  );

  await eventsRepo.save(eventEntities);
  logStep(`[Session ${sessionNumber}] Created ${eventEntities.length} events`);
}

/**
 * Creates scenario session chat for v2 API testing
 */
async function createScenarioSessionChat(
  dataSource: DataSource,
  scenarioSessionId: string,
  counselorId: number,
  tenantId: string,
  sessionNumber: number,
): Promise<void> {
  const chatRepo = dataSource.getRepository(ScenarioSessionChat);
  const chatMessageRepo = dataSource.getRepository(ScenarioSessionChatMessage);

  // Create chat
  const chat = chatRepo.create({
    scenarioSessionId,
    userId: counselorId,
    tenantId,
    summarizedMessageCount: 0,
  });

  const savedChat = (await chatRepo.save(chat)) as ScenarioSessionChat;
  logStep(`[Session ${sessionNumber}] Created scenario session chat`);

  // Create sample chat messages with transcript references
  const chatMessages = [
    {
      chatId: savedChat.id,
      senderId: counselorId,
      content: "How did I handle the client's resistance?",
      tenantId,
    },
    {
      chatId: savedChat.id,
      senderId: -1,
      content:
        sessionNumber === 1
          ? 'You responded to resistance with validation and gentle problem-solving, which reduced defensiveness (e.g., validated feelings at [5:46] and offered "start small" steps at [5:18]). You sometimes moved quickly to solutions instead of lingering on emotion—examples: offering noise-reduction strategies at [2:52] and mindfulness at [3:47] right after the client said tension persisted ([3:10]). Next time, hold the emotional space longer (reflect the "heavy" feeling at [6:02], use silence or brief paraphrase at [6:23]) before proposing strategies so the client feels fully heard.'
          : "You handled the client's initial resistance well by acknowledging it directly ([0:13]). Your exploration of what brought them to therapy was effective ([0:25]). However, you could have explored the sleep issues in more depth. The client mentioned trouble sleeping ([0:52]) but you moved quickly to asking about contributing factors ([0:87]). Consider spending more time understanding the specific sleep patterns and their impact before moving to analysis.",
      tenantId,
    },
  ];

  const chatMessageEntities = chatMessages.map((msg) =>
    chatMessageRepo.create(msg),
  );

  await chatMessageRepo.save(chatMessageEntities);
  logStep(
    `[Session ${sessionNumber}] Created ${chatMessageEntities.length} chat messages`,
  );
}

/**
 * Main function
 */
async function main() {
  logStep('Starting scenario session seed script');
  logStep(`Connecting to API at: ${API_BASE_URL}`);

  const client = axios.create({
    baseURL: API_BASE_URL,
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  try {
    // Login
    const { accessToken } = await login(client);
    client.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;

    // Get or create tenant
    const tenantId = await getOrCreateTenant(client, accessToken);

    // Get or create counselor
    const counselorId = await getOrCreateCounselor(
      client,
      accessToken,
      tenantId,
    );

    // Get or create scenario
    const scenarioId = await getOrCreateScenario(client, accessToken);

    // Initialize database connection
    const dataSource = createSeedDataSource(
      [
        ScenarioSessions,
        ScenarioSessionMessages,
        ScenarioSessionDetails,
        ScenarioSessionEvents,
        ScenarioSessionChat,
        ScenarioSessionChatMessage,
      ],
      false,
    );

    await dataSource.initialize();
    logStep('Database connection established');

    try {
      // Create 2 scenario sessions
      const sessionIds: string[] = [];

      for (let i = 1; i <= 2; i++) {
        logStep(`\n--- Creating Scenario Session ${i} ---`);
        const sessionId = await createScenarioSession(
          dataSource,
          scenarioId,
          counselorId,
          tenantId,
          i,
        );
        sessionIds.push(sessionId);
      }

      logStep(
        '\n✅ Successfully created 2 scenario sessions with all related data!',
      );
      console.log('\n📋 Summary:');
      console.log(`   Counselor ID: ${counselorId}`);
      console.log(`   Scenario ID: ${scenarioId}`);
      console.log(`   Session IDs:`);
      sessionIds.forEach((id, index) => {
        console.log(`     ${index + 1}. ${id}`);
      });
      console.log('\n💡 You can now test the v2 API with these session IDs.');
    } finally {
      await dataSource.destroy();
    }
  } catch (error: any) {
    console.error('❌ Error seeding scenario sessions:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { createScenarioSession };
