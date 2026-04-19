import * as fs from 'fs';
import * as path from 'path';
import axios, { AxiosInstance } from 'axios';
import { config } from 'dotenv';

import { logStep } from './seed-utils';

config();

type ScenarioVoiceSeed = {
  name: string;
  provider: string;
  config: Record<string, any>;
  languageId: number;
};

type SessionEventSeed = {
  id: string;
  name: string;
  description?: string;
  score?: number;
  emoji?: string;
  message?: string;
  branchInstruction?: string;
  detectionType?: string;
  visibilityType?: string;
  detectionData?: any;
  eventCode: string;
  createdBy?: number;
  updatedBy?: number;
};

const scenarioVoicesPath = path.resolve(
  __dirname,
  'data',
  'scenario-voices.json',
);
const sessionEventsPath = path.resolve(
  __dirname,
  'data',
  'session-events.json',
);

function readJsonFile<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

const API_BASE_URL = process.env.SEED_API_BASE_URL || 'http://localhost:8001';

// Admin credentials for authentication
const adminCredentials = {
  username: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
  password: process.env.SEED_ADMIN_PASSWORD || 'Password123!',
};

async function login(
  client: AxiosInstance,
): Promise<{ accessToken: string; refreshToken: string }> {
  try {
    const response = await client.post('/api/v1/auth/login', adminCredentials);
    logStep('[seed-voices-and-events] Login successful');
    return {
      accessToken: response.data.accessToken,
      refreshToken: response.data.refreshToken,
    };
  } catch (error: any) {
    logStep(
      `[seed-voices-and-events] Login failed: ${error.response?.data?.message || error.message}`,
    );
    throw error;
  }
}

async function seedScenarioVoices(
  client: AxiosInstance,
  accessToken: string,
  voicesData: ScenarioVoiceSeed[],
): Promise<void> {
  const headers = { Authorization: `Bearer ${accessToken}` };

  try {
    let insertedVoices = 0;
    let updatedVoices = 0;

    try {
      // Try to create new voice
      await client.post(
        '/api/v1/learn/scenarios/voices',
        { voices: voicesData },
        {
          headers,
        },
      );
      insertedVoices++;
      logStep(
        `[seed-voices-and-events]   ✓ Created voice: ${JSON.stringify(voicesData)}`,
      );
    } catch (error: any) {
      console.log(error);
      if (error.response?.status === 409 || error.response?.status === 400) {
        // Voice might already exist, try to update
        logStep(
          `[seed-voices-and-events]   ℹ️  Voice exists, skipping: ${voicesData}`,
        );
        updatedVoices++;
      } else {
        throw error;
      }
    }

    logStep(
      `[seed-voices-and-events] Scenario voices processed. Created: ${insertedVoices}, Skipped: ${updatedVoices}`,
    );
  } catch (error: any) {
    logStep(
      `[seed-voices-and-events] Failed to seed voices: ${error.response?.data?.message || error.message}`,
    );
    throw error;
  }
}

async function seedSessionEvents(
  client: AxiosInstance,
  accessToken: string,
  eventsData: SessionEventSeed[],
): Promise<void> {
  const headers = { Authorization: `Bearer ${accessToken}` };

  try {
    let insertedEvents = 0;
    let updatedEvents = 0;

    for (const eventSeed of eventsData) {
      console.log(eventSeed, 'eventSeed');
      try {
        // Try to create new event
        await client.post(
          '/api/v1/session-events',
          { events: [eventSeed] },
          {
            headers,
          },
        );
        insertedEvents++;
        logStep(
          `[seed-voices-and-events]   ✓ Created event: ${eventSeed.name}`,
        );
      } catch (error: any) {
        if (error.response?.status === 409 || error.response?.status === 400) {
          // Event might already exist, try to update
          await client.put(
            `/api/v1/session-events/events/${eventSeed.id}`,
            eventSeed,
            {
              headers,
            },
          );
          updatedEvents++;
          logStep(
            `[seed-voices-and-events]   ✓ Updated event: ${eventSeed.name}`,
          );
        } else {
          throw error;
        }
      }
    }

    logStep(
      `[seed-voices-and-events] Session events processed. Created: ${insertedEvents}, Updated: ${updatedEvents}`,
    );
  } catch (error: any) {
    logStep(
      `[seed-voices-and-events] Failed to seed events: ${error.response?.data?.message || error.message}`,
    );
    throw error;
  }
}

async function seedVoicesAndEvents() {
  logStep(`[seed-voices-and-events] Connecting to API at: ${API_BASE_URL}`);

  const client = axios.create({
    baseURL: API_BASE_URL,
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  try {
    // Read data from JSON files
    const scenarioVoices =
      readJsonFile<ScenarioVoiceSeed[]>(scenarioVoicesPath);
    const sessionEvents = readJsonFile<SessionEventSeed[]>(sessionEventsPath);

    // Login to get access token
    const { accessToken } = await login(client);

    // Seed voices
    logStep('[seed-voices-and-events] Seeding scenario voices...');
    await seedScenarioVoices(client, accessToken, scenarioVoices);

    // Seed events
    logStep('[seed-voices-and-events] Seeding session events...');
    await seedSessionEvents(client, accessToken, sessionEvents);

    logStep(
      '[seed-voices-and-events] ✅ Scenario voices & session events seeding complete',
    );
  } catch (error: any) {
    logStep(
      `[seed-voices-and-events] ❌ Error during seeding: ${error.message}`,
    );
    process.exit(1);
  }
}

seedVoicesAndEvents();
