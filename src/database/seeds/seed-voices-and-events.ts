import * as fs from 'fs';
import * as path from 'path';
import { DeepPartial } from 'typeorm';

import { ScenarioVoices } from '../../learn/entity/scenario-voices.entity';
import { SessionEvents } from '../../session-event/entity/session-events.entity';
import { SessionEventDetectionType } from '../../session-event/enum/session-event-detection.enum';
import { SessionEventVisibilityType } from '../../session-event/enum/session-event-visibility-type.enum';
import { createSeedDataSource, logStep } from './seed-utils';

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
  detectionType?: SessionEventDetectionType | `${SessionEventDetectionType}`;
  visibilityType?: SessionEventVisibilityType | `${SessionEventVisibilityType}`;
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

function parseDetectionData(value: any) {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn(`[seed] Failed to parse detection data: ${value}`);
    return value;
  }
}

function resolveEnumValue<T extends Record<string, string>>(
  enumObj: T,
  input: string | undefined,
  fallback: T[keyof T],
) {
  if (!input) {
    return fallback;
  }

  const matched =
    enumObj[input as keyof typeof enumObj] ??
    enumObj[input.toUpperCase() as keyof typeof enumObj];

  return matched ?? fallback;
}

async function seedVoicesAndEvents() {
  const scenarioVoices = readJsonFile<ScenarioVoiceSeed[]>(scenarioVoicesPath);
  const sessionEvents = readJsonFile<SessionEventSeed[]>(sessionEventsPath);

  const dataSource = createSeedDataSource(
    [ScenarioVoices, SessionEvents],
    false,
  );
  await dataSource.initialize();

  try {
    const scenarioVoicesRepo = dataSource.getRepository(ScenarioVoices);
    const sessionEventsRepo = dataSource.getRepository(SessionEvents);

    let insertedVoices = 0;
    let updatedVoices = 0;

    for (const voiceSeed of scenarioVoices) {
      const existingVoice = await scenarioVoicesRepo.findOne({
        where: {
          name: voiceSeed.name,
          provider: voiceSeed.provider,
          languageId: voiceSeed.languageId,
        },
      });

      if (existingVoice) {
        const updated = scenarioVoicesRepo.merge(existingVoice, {
          config: voiceSeed.config,
        });
        await scenarioVoicesRepo.save(updated);
        updatedVoices += 1;
      } else {
        const newVoice = scenarioVoicesRepo.create(voiceSeed);
        await scenarioVoicesRepo.save(newVoice);
        insertedVoices += 1;
      }
    }

    logStep(
      `Scenario voices upserted. Inserted: ${insertedVoices}, Updated: ${updatedVoices}`,
    );

    let insertedEvents = 0;
    let updatedEvents = 0;

    for (const eventSeed of sessionEvents) {
      const detectionType = resolveEnumValue(
        SessionEventDetectionType,
        eventSeed.detectionType,
        SessionEventDetectionType.SENTENCE_SIMILARITY,
      );
      const visibilityType = resolveEnumValue(
        SessionEventVisibilityType,
        eventSeed.visibilityType,
        SessionEventVisibilityType.ACTIVE,
      );

      const payload: DeepPartial<SessionEvents> = {
        ...eventSeed,
        detectionType,
        visibilityType,
        detectionData: parseDetectionData(eventSeed.detectionData),
      };

      const existingEvent = await sessionEventsRepo.findOne({
        where: { id: eventSeed.id },
        withDeleted: true,
      });

      if (existingEvent) {
        const updated = sessionEventsRepo.merge(existingEvent, payload);
        updated.deletedAt = undefined;
        await sessionEventsRepo.save(updated);
        updatedEvents += 1;
      } else {
        const newEvent = sessionEventsRepo.create(payload);
        await sessionEventsRepo.save(newEvent);
        insertedEvents += 1;
      }
    }

    logStep(
      `Session events upserted. Inserted: ${insertedEvents}, Updated: ${updatedEvents}`,
    );

    logStep('Scenario voices & session events seeding complete ✅');
  } catch (error) {
    console.error(
      '[seed] Failed to seed scenario voices and session events',
      error,
    );
    process.exit(1);
  } finally {
    await dataSource.destroy();
  }
}

seedVoicesAndEvents();
