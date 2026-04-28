import { DataSource } from 'typeorm';
import { ScenarioSessions } from '../../../learn/entity/scenario-sessions.entity';
import { ScenarioSessionMessages } from '../../../learn/entity/scenario-session-messages.entity';
import { Scenarios } from '../../../learn/entity/scenarios.entity';
import { User } from '../../../user/entity/user.entity';
import { ScenarioSessionMessageType } from '../../../learn/enum/scenario-session-message.type.enum';
import { ANONYMOUS_CLIENT_ID } from '../../../common/constants/user.constants';
import { getRepo, log } from '../helpers';
import { sessions, scenarios } from '../fixtures';
import { TENANT_CODE } from '../config';

export async function seedSessions(ds: DataSource): Promise<void> {
  const sessionRepo = getRepo(ds, ScenarioSessions);
  const messageRepo = getRepo(ds, ScenarioSessionMessages);
  const scenarioRepo = getRepo(ds, Scenarios);
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

  let created = 0;
  let existingCount = 0;
  let messageCount = 0;

  for (const fixture of sessions) {
    const scenarioId = scenarioIdByKey.get(fixture.scenarioKey);
    if (!scenarioId) continue;

    const roomId = `seed-room-${fixture.scenarioKey}-${fixture.status.toLowerCase()}`;
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

    let offset = 0;
    for (const turn of fixture.transcript) {
      const start = offset;
      const end = offset + 8;
      offset = end + 2;
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
  }

  log(
    `sessions: ${created} created, ${existingCount} already existed ` +
      `(${messageCount} messages added)`,
  );
}
