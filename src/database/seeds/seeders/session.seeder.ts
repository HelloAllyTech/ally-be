import { DataSource } from 'typeorm';
import { ScenarioSessions } from '../../../learn/entity/scenario-sessions.entity';
import { ScenarioSessionMessages } from '../../../learn/entity/scenario-session-messages.entity';
import { ScenarioSessionEvents } from '../../../learn/entity/scenario-session-events.entity';
import { Scenarios } from '../../../learn/entity/scenarios.entity';
import { SessionEvents } from '../../../session-event/entity/session-events.entity';
import { User } from '../../../user/entity/user.entity';
import { ScenarioSessionMessageType } from '../../../learn/enum/scenario-session-message.type.enum';
import { ANONYMOUS_CLIENT_ID } from '../../../common/constants/user.constants';
import { getRepo, log } from '../helpers';
import { sessions, scenarios } from '../fixtures';
import { TENANT_CODE } from '../config';

export async function seedSessions(ds: DataSource): Promise<void> {
  const sessionRepo = getRepo(ds, ScenarioSessions);
  const messageRepo = getRepo(ds, ScenarioSessionMessages);
  const sessionEventRepo = getRepo(ds, ScenarioSessionEvents);
  const scenarioRepo = getRepo(ds, Scenarios);
  const eventRepo = getRepo(ds, SessionEvents);
  const userRepo = getRepo(ds, User);

  const counselor = await userRepo.findOne({
    where: { email: 'learner@example.com' },
  });
  if (!counselor) {
    log('learner@example.com missing — skipping session seed');
    return;
  }

  const scenarioIdByKey = new Map<string, number>();
  for (const fixture of scenarios) {
    const row = await scenarioRepo.findOne({ where: { title: fixture.title } });
    if (row) scenarioIdByKey.set(fixture.key, row.id);
  }

  const eventByCode = new Map(
    (await eventRepo.find()).map((e) => [e.eventCode, e]),
  );

  let created = 0;
  let existingCount = 0;
  let messageCount = 0;
  let eventCount = 0;

  for (const fixture of sessions) {
    const scenarioId = scenarioIdByKey.get(fixture.scenarioKey);
    if (!scenarioId) continue;

    const roomId = `seed-room-${fixture.roomKey}`;
    const existing = await sessionRepo.findOne({ where: { roomId } });
    if (existing) {
      existingCount++;
      continue;
    }

    const startedAt = new Date(
      Date.now() - fixture.durationMinutes * 60 * 1000,
    );
    const endedAt = fixture.status === 'ENDED' ? new Date() : undefined;

    const session = await sessionRepo.save(
      sessionRepo.create({
        roomId,
        scenarioId,
        counselorId: counselor.id,
        status: fixture.status,
        eventStatus: fixture.eventStatus,
        startedAt,
        endedAt,
        score: fixture.score,
        tenantId: TENANT_CODE,
      }),
    );
    created++;

    const turnTimings: Array<{ start: number; end: number }> = [];
    let offset = 0;
    for (const turn of fixture.transcript) {
      const start = offset;
      const end = offset + 8;
      offset = end + 2;
      turnTimings.push({ start, end });
      await messageRepo.save(
        messageRepo.create({
          scenarioSessionId: session.id,
          senderId:
            turn.from === 'counselor' ? counselor.id : ANONYMOUS_CLIENT_ID,
          messageType: ScenarioSessionMessageType.TEXT,
          content: turn.content,
          startSeconds: start,
          endSeconds: end,
          tenantId: TENANT_CODE,
        }),
      );
      messageCount++;
    }

    for (const ev of fixture.events ?? []) {
      const event = eventByCode.get(ev.eventCode);
      const timing = turnTimings[ev.occurredAtTurnIndex];
      if (!event || !timing || !startedAt) continue;

      const occurredAt = new Date(startedAt.getTime() + timing.end * 1000);
      await sessionEventRepo.save(
        sessionEventRepo.create({
          scenarioSessionId: session.id,
          eventId: event.id,
          occurredAt,
          score: event.score,
          emoji: event.emoji,
          message: event.message,
          tenantId: TENANT_CODE,
        }),
      );
      eventCount++;
    }
  }

  log(
    `sessions: ${created} created, ${existingCount} already existed ` +
      `(${messageCount} messages, ${eventCount} session events added)`,
  );
}
