import { DataSource, Repository } from 'typeorm';
import { ScenarioSessions } from '../../../learn/entity/scenario-sessions.entity';
import { ScenarioSessionMessages } from '../../../learn/entity/scenario-session-messages.entity';
import { ScenarioSessionEvents } from '../../../learn/entity/scenario-session-events.entity';
import { ScenarioSessionDetails } from '../../../learn/entity/scenario-session-details.entity';
import { ScenarioSessionChat } from '../../../learn/entity/scenario-session-chat.entity';
import { ScenarioSessionChatMessage } from '../../../learn/entity/scenario-session-chat-message.entity';
import { ScenarioSessionFeedbacks } from '../../../learn/entity/scenario-session-feedbacks.entity';
import { ScenarioSessionRecording } from '../../../learn/entity/scenario-session-recording.entity';
import { ScenarioSessionTurnMetrics } from '../../../learn/entity/scenario-session-turn-metrics.entity';
import { ScenarioSessionStartMetrics } from '../../../learn/entity/scenario-session-start-metrics.entity';
import { ScenarioSessionTags } from '../../../learn/entity/scenario-session-tags.entity';
import { ScenarioSessionMessageTags } from '../../../learn/entity/scenario-session-message-tags.entity';
import { ScenarioSessionTagCategory } from '../../../learn/enum/scenario-session-tag-category.enum';
import { ScenarioSessionBehaviorInstructions } from '../../../learn/entity/scenario-session-behavior-instructions.entity';
import { ScenarioBehaviorInstruction } from '../../../learn/entity/scenario-behavior-instruction.entity';
import { Scenarios } from '../../../learn/entity/scenarios.entity';
import { SessionEvents } from '../../../session-event/entity/session-events.entity';
import { User } from '../../../user/entity/user.entity';
import { ScenarioSessionMessageType } from '../../../learn/enum/scenario-session-message.type.enum';
import { ScenarioSessionStatus } from '../../../learn/enum/scenario-session-status.enum';
import { ANONYMOUS_CLIENT_ID } from '../../../common/constants/user.constants';
import { getRepo, log, upsert } from '../helpers';
import { sessions, scenarios, SessionFixture } from '../fixtures';

const SESSION_TAGS = [
  { label: 'Strong rapport', category: ScenarioSessionTagCategory.POSITIVE },
  {
    label: 'Handled risk disclosure well',
    category: ScenarioSessionTagCategory.POSITIVE,
  },
  {
    label: 'Needs work: active listening',
    category: ScenarioSessionTagCategory.NEGATIVE,
  },
];

// Fixed (not random) so re-running the seed against the same session stays
// idempotent — promptId is a uuid column with no backing catalog table.

function feedbackForScore(score: number): {
  rating: number;
  feedback: string;
  tags: string[];
} {
  if (score >= 85) {
    return {
      rating: 5,
      feedback:
        'The pacing felt natural and I never felt rushed. This is closest to how a real session should go.',
      tags: ['rapport', 'pacing'],
    };
  }
  if (score >= 70) {
    return {
      rating: 4,
      feedback:
        'Good session overall — a couple of moments where I would have liked more space before the next question.',
      tags: ['pacing'],
    };
  }
  return {
    rating: 2,
    feedback:
      'The advice came too early and it did not feel like the counselor was really listening to what I said.',
    tags: ['advice-too-early', 'listening'],
  };
}

export async function seedSessions(ds: DataSource): Promise<void> {
  const sessionRepo = getRepo(ds, ScenarioSessions);
  const messageRepo = getRepo(ds, ScenarioSessionMessages);
  const sessionEventRepo = getRepo(ds, ScenarioSessionEvents);
  const detailsRepo = getRepo(ds, ScenarioSessionDetails);
  const chatRepo = getRepo(ds, ScenarioSessionChat);
  const chatMessageRepo = getRepo(ds, ScenarioSessionChatMessage);
  const feedbackRepo = getRepo(ds, ScenarioSessionFeedbacks);
  const recordingRepo = getRepo(ds, ScenarioSessionRecording);
  const turnMetricsRepo = getRepo(ds, ScenarioSessionTurnMetrics);
  const startMetricsRepo = getRepo(ds, ScenarioSessionStartMetrics);
  const tagRepo = getRepo(ds, ScenarioSessionTags);
  const messageTagRepo = getRepo(ds, ScenarioSessionMessageTags);
  const behaviorInstructionRepo = getRepo(ds, ScenarioBehaviorInstruction);
  const sessionBehaviorInstructionRepo = getRepo(
    ds,
    ScenarioSessionBehaviorInstructions,
  );
  const scenarioRepo = getRepo(ds, Scenarios);
  const eventRepo = getRepo(ds, SessionEvents);
  const userRepo = getRepo(ds, User);

  const scenarioIdByKey = new Map<string, number>();
  for (const fixture of scenarios) {
    const row = await scenarioRepo.findOne({ where: { title: fixture.title } });
    if (row) scenarioIdByKey.set(fixture.key, row.id);
  }

  const eventByCode = new Map(
    (await eventRepo.find()).map((e) => [e.eventCode, e]),
  );

  const tagByLabel = new Map<string, ScenarioSessionTags>();
  for (const fixture of SESSION_TAGS) {
    const tag = await upsert(
      tagRepo,
      { label: fixture.label },
      { label: fixture.label },
    );
    tagByLabel.set(fixture.label, tag);
  }

  const userCache = new Map<string, User>();
  async function resolveCounselor(email: string): Promise<User | undefined> {
    if (userCache.has(email)) return userCache.get(email);
    const found = await userRepo.findOne({ where: { email } });
    if (found) userCache.set(email, found);
    return found ?? undefined;
  }

  let created = 0;
  let existingCount = 0;
  let messageCount = 0;
  let eventCount = 0;

  for (const fixture of sessions) {
    const scenarioId = scenarioIdByKey.get(fixture.scenarioKey);
    if (!scenarioId) continue;

    const counselor = await resolveCounselor(
      fixture.counselorEmail ?? 'learner@example.com',
    );
    if (!counselor) {
      log(
        `counselor "${fixture.counselorEmail}" missing — skipping session ${fixture.roomKey}`,
      );
      continue;
    }

    const roomId = `seed-room-${fixture.roomKey}`;
    const existing = await sessionRepo.findOne({ where: { roomId } });
    if (existing) {
      existingCount++;
      continue;
    }

    const startedAt = new Date(
      Date.now() - fixture.durationMinutes * 60 * 1000,
    );
    const isEnded = fixture.status === ScenarioSessionStatus.ENDED;
    const endedAt = isEnded ? new Date() : undefined;

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
        tenantId: counselor.tenantId,
      }),
    );
    created++;

    const turnTimings: Array<{ start: number; end: number }> = [];
    let offset = 0;
    const savedMessages: ScenarioSessionMessages[] = [];
    for (const turn of fixture.transcript) {
      const start = offset;
      const end = offset + 8;
      offset = end + 2;
      turnTimings.push({ start, end });
      const message = await messageRepo.save(
        messageRepo.create({
          scenarioSessionId: session.id,
          senderId:
            turn.from === 'counselor' ? counselor.id : ANONYMOUS_CLIENT_ID,
          messageType: ScenarioSessionMessageType.TEXT,
          content: turn.content,
          startSeconds: start,
          endSeconds: end,
          tenantId: counselor.tenantId,
        }),
      );
      savedMessages.push(message);
      messageCount++;
    }

    for (const ev of fixture.events ?? []) {
      const event = eventByCode.get(ev.eventCode);
      const timing = turnTimings[ev.occurredAtTurnIndex];
      if (!event || !timing) continue;

      const occurredAt = new Date(startedAt.getTime() + timing.end * 1000);
      await sessionEventRepo.save(
        sessionEventRepo.create({
          scenarioSessionId: session.id,
          eventId: event.id,
          occurredAt,
          score: event.score,
          emoji: event.emoji,
          message: event.message,
          tenantId: counselor.tenantId,
        }),
      );
      eventCount++;
    }

    await seedStartMetrics(
      startMetricsRepo,
      session,
      scenarioId,
      startedAt,
      counselor.tenantId,
    );
    await seedTurnMetrics(
      turnMetricsRepo,
      session,
      scenarioId,
      startedAt,
      turnTimings,
      fixture,
      counselor.tenantId,
    );

    if (isEnded) {
      await seedSessionDetails(
        detailsRepo,
        session,
        fixture,
        counselor.tenantId,
      );
      await seedRecording(recordingRepo, session, counselor.tenantId);
      await seedFeedback(feedbackRepo, session, fixture, counselor.tenantId);
      await seedChatThread(
        chatRepo,
        chatMessageRepo,
        session,
        counselor,
        fixture,
        counselor.tenantId,
      );
      await seedMessageTags(
        messageTagRepo,
        tagByLabel,
        session,
        savedMessages,
        fixture,
        counselor.tenantId,
      );
      await seedBehaviorInstructionOccurrence(
        behaviorInstructionRepo,
        sessionBehaviorInstructionRepo,
        session,
        scenarioId,
        endedAt ?? startedAt,
      );
    }
  }

  log(
    `sessions: ${created} created, ${existingCount} already existed ` +
      `(${messageCount} messages, ${eventCount} session events added)`,
  );
}

async function seedStartMetrics(
  repo: Repository<ScenarioSessionStartMetrics>,
  session: ScenarioSessions,
  scenarioId: number,
  startedAt: Date,
  tenantId: string,
): Promise<void> {
  const configureMs = 180 + Math.round(Math.random() * 120);
  const initializeMs = 90 + Math.round(Math.random() * 60);
  const connectMs = 420 + Math.round(Math.random() * 280);
  const prepMs = 60 + Math.round(Math.random() * 40);
  await upsert(
    repo,
    { scenarioSessionId: session.id },
    {
      roomId: session.roomId,
      startLatencyMs: configureMs + initializeMs + connectMs + prepMs,
      configureMs,
      initializeMs,
      connectMs,
      prepMs,
      openingPlayoutMs: 2200 + Math.round(Math.random() * 1500),
      scenarioId,
      language: 'en-IN',
      env: 'development',
      occurredAt: startedAt,
      source: 'pipeline',
      tenantId,
    },
  );
}

async function seedTurnMetrics(
  repo: Repository<ScenarioSessionTurnMetrics>,
  session: ScenarioSessions,
  scenarioId: number,
  startedAt: Date,
  turnTimings: Array<{ start: number; end: number }>,
  fixture: SessionFixture,
  tenantId: string,
): Promise<void> {
  for (let i = 0; i < turnTimings.length; i++) {
    if (fixture.transcript[i]?.from !== 'client') continue; // agent responds to client turns

    const eouDelayMs = 250 + Math.round(Math.random() * 200);
    const llmTtftMs = 400 + Math.round(Math.random() * 500);
    const ttsTtfbMs = 150 + Math.round(Math.random() * 150);
    const orchestrationMs = 40 + Math.round(Math.random() * 60);
    const llmResponseMs = llmTtftMs + 300 + Math.round(Math.random() * 400);
    const interrupted = i === turnTimings.length - 1 && Math.random() > 0.85;

    await upsert(
      repo,
      { scenarioSessionId: session.id, roomId: session.roomId, turnIndex: i },
      {
        responseLatencyMs: eouDelayMs + llmTtftMs + ttsTtfbMs + orchestrationMs,
        eouDelayMs,
        llmTtftMs,
        ttsTtfbMs,
        orchestrationMs,
        llmResponseMs,
        branchingMs: 15 + Math.round(Math.random() * 25),
        processEventsMs: 30 + Math.round(Math.random() * 50),
        behaviorsMs: 20 + Math.round(Math.random() * 40),
        scenarioId,
        language: 'en-IN',
        llmModel: 'claude-sonnet-4-6',
        llmProvider: 'anthropic',
        env: 'development',
        responseChars: fixture.transcript[i]?.content.length ?? 0,
        eventsDetected: fixture.events?.some((e) => e.occurredAtTurnIndex === i)
          ? 1
          : 0,
        interrupted,
        llmTimedOut: false,
        occurredAt: new Date(startedAt.getTime() + turnTimings[i].end * 1000),
        source: 'pipeline',
        tenantId,
      },
    );
  }
}

async function seedSessionDetails(
  repo: Repository<ScenarioSessionDetails>,
  session: ScenarioSessions,
  fixture: SessionFixture,
  tenantId: string,
): Promise<void> {
  const composite = fixture.score ?? 70;
  const jitter = () =>
    Math.max(
      0,
      Math.min(100, composite + Math.round((Math.random() - 0.5) * 16)),
    );
  await upsert(
    repo,
    { scenarioSessionId: session.id },
    {
      callDuration: fixture.durationMinutes * 60 * 1000,
      summary: {
        headline: `${fixture.durationMinutes}-minute practice session, ${fixture.transcript.length} turns.`,
      },
      metrics: {
        'Builds rapport': jitter(),
        'Validates emotional experience': jitter(),
        'Avoids premature advice-giving': jitter(),
        'Manages risk appropriately': jitter(),
      },
      compositeScore: composite,
      evaluationMarkdown:
        composite >= 85
          ? '**Strong session.** Rapport built early and the counselor consistently reflected feelings before moving the conversation forward.'
          : composite >= 70
            ? '**Solid session** with room to grow — a couple of turns moved to problem-solving before the client had fully explored the feeling.'
            : '**Needs practice.** Advice and reassurance arrived before the client felt heard; revisit the reflective-listening module.',
      evaluationStatus: 'COMPLETED',
      evaluatedAt: new Date(),
      tenantId,
    },
  );
}

async function seedRecording(
  repo: Repository<ScenarioSessionRecording>,
  session: ScenarioSessions,
  tenantId: string,
): Promise<void> {
  await upsert(
    repo,
    { scenarioSessionId: session.id },
    {
      storageKey: `recordings/scenario-sessions/${session.id}/egress.mp4`,
      egressId: `EG_${session.id.replace(/-/g, '').slice(0, 20)}`,
      tenantId,
    },
  );
}

async function seedFeedback(
  repo: Repository<ScenarioSessionFeedbacks>,
  session: ScenarioSessions,
  fixture: SessionFixture,
  tenantId: string,
): Promise<void> {
  const { rating, feedback, tags } = feedbackForScore(fixture.score ?? 70);
  await upsert(
    repo,
    { scenarioSessionId: session.id },
    { rating, feedback, tags, tenantId },
  );
}

async function seedChatThread(
  chatRepo: Repository<ScenarioSessionChat>,
  chatMessageRepo: Repository<ScenarioSessionChatMessage>,
  session: ScenarioSessions,
  counselor: User,
  fixture: SessionFixture,
  tenantId: string,
): Promise<void> {
  const chat = await upsert(
    chatRepo,
    { scenarioSessionId: session.id, userId: counselor.id },
    {
      summary: `Quick text check-in during the "${fixture.scenarioKey}" run.`,
      summarizedMessageCount: 2,
      tenantId,
    },
  );
  const existingMessages = await chatMessageRepo.find({
    where: { chatId: chat.id },
  });
  if (existingMessages.length > 0) return;

  await chatMessageRepo.save(
    chatMessageRepo.create({
      chatId: chat.id,
      senderId: counselor.id,
      content:
        'Quick one — is it okay if I pause here for a second and re-read the last line?',
      tenantId,
    }),
  );
  await chatMessageRepo.save(
    chatMessageRepo.create({
      chatId: chat.id,
      senderId: -1,
      content: 'Of course — take the time you need before responding.',
      tenantId,
    }),
  );
}

async function seedMessageTags(
  repo: Repository<ScenarioSessionMessageTags>,
  tagByLabel: Map<string, ScenarioSessionTags>,
  session: ScenarioSessions,
  savedMessages: ScenarioSessionMessages[],
  fixture: SessionFixture,
  tenantId: string,
): Promise<void> {
  if (savedMessages.length === 0) return;
  const label =
    (fixture.score ?? 70) >= 85
      ? 'Strong rapport'
      : (fixture.score ?? 70) < 65
        ? 'Needs work: active listening'
        : fixture.events?.length
          ? 'Handled risk disclosure well'
          : 'Strong rapport';
  const tag = tagByLabel.get(label);
  if (!tag) return;

  const targetMessage = savedMessages[Math.min(2, savedMessages.length - 1)];
  await upsert(
    repo,
    {
      scenarioSessionId: session.id,
      messageId: targetMessage.id,
      tagId: tag.id,
    },
    {
      category:
        label === 'Needs work: active listening'
          ? ScenarioSessionTagCategory.NEGATIVE
          : ScenarioSessionTagCategory.POSITIVE,
      tenantId,
    },
  );
}

async function seedBehaviorInstructionOccurrence(
  behaviorInstructionRepo: Repository<ScenarioBehaviorInstruction>,
  sessionBehaviorInstructionRepo: Repository<ScenarioSessionBehaviorInstructions>,
  session: ScenarioSessions,
  scenarioId: number,
  occurredAt: Date,
): Promise<void> {
  const instruction = await behaviorInstructionRepo.findOne({
    where: { scenarioId },
  });
  if (!instruction) return;

  await upsert(
    sessionBehaviorInstructionRepo,
    {
      scenarioSessionId: session.id,
      scenarioBehaviorInstructionId: instruction.id,
    },
    { occurredAt },
  );
}
