import { DataSource } from 'typeorm';
import { SessionEvents } from '../../../session-event/entity/session-events.entity';
import { getRepo, log, upsert } from '../helpers';
import { sessionEvents, defaults } from '../fixtures';

export async function seedSessionEvents(ds: DataSource): Promise<void> {
  const repo = getRepo(ds, SessionEvents);
  for (const fixture of sessionEvents) {
    await upsert(
      repo,
      { eventCode: fixture.eventCode },
      {
        id: fixture.id,
        name: fixture.name,
        score: fixture.score,
        emoji: fixture.emoji,
        message: fixture.message,
        detectionType: fixture.detectionType,
        detectionData: fixture.detectionData as any,
        visibilityType: defaults.eventVisibility,
      },
    );
  }
  log(`session events: ${sessionEvents.length}`);
}
