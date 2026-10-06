import { DataSource } from 'typeorm';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  AI_TASK_REGISTRY,
  callConfigForAiTask,
} from 'src/llm/constants/ai-task-registry.constants';
import { SESSION_COST_COMPONENT_BY_TASK } from 'src/analytics/constants/session-cost.constants';
import { TASK_AREA } from 'src/analytics/repository/roleplay-cost-analytics.repository';
import {
  FHS_MAX_ATTEMPTS,
  FHS_RUBRIC_VERSION,
} from '../constants/helping-skills-rubric.constants';
import {
  FEEDBACK_SKILL_MAPPER_MAX_ITEMS,
  FEEDBACK_SKILL_MAPPER_MODEL,
  FEEDBACK_SKILL_MAPPER_TASK_ID,
  FEEDBACK_SKILL_MAPPER_VERSION,
  FEEDBACK_SKILL_MAPPINGS_PER_TICK,
  FEEDBACK_SKILL_MAPPING_SCHEDULE_ENV,
} from '../constants/feedback-skill-mapper.constants';
import { FeedbackSkillLinkStatus } from '../enum/feedback-skill-link.enum';
import { FeedbackSkillMappingRepository } from '../repository/feedback-skill-mapping.repository';
import { FeedbackSkillMapperService } from '../service/feedback-skill-mapper.service';
import { FeedbackSkillMappingService } from '../service/feedback-skill-mapping.service';
import { FeedbackSkillMappingSchedulerRegistrationService } from '../service/feedback-skill-mapping-scheduler-registration.service';

const target = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  userId: 42,
  tenantId: 'tenant-a',
  endedAt: new Date('2026-09-01T10:00:00Z'),
  attempts: 0,
};

/** Synthetic debrief — placeholder strings, not from any session. */
const debrief = {
  areasOfGrowth: [
    { improvement: 'improvement one', recommendation: 'recommendation one' },
    { improvement: 'improvement two', recommendation: 'recommendation two' },
  ],
};

describe('FeedbackSkillMapperService', () => {
  const llmReturning = (text: string) => ({
    complete: jest.fn().mockResolvedValue({
      text,
      model: FEEDBACK_SKILL_MAPPER_MODEL,
      provider: 'openai',
      source: 'request',
      usage: { inputTokens: 3400, outputTokens: 60 },
    }),
  });

  it('makes ONE pinned, temperature-0, JSON call per session, tagged to the session', async () => {
    const llm = llmReturning(
      JSON.stringify({
        items: [
          { index: 1, skill: 'feelings' },
          { index: 2, skill: null },
        ],
      }),
    );
    const mapper = new FeedbackSkillMapperService(llm as any);

    const outcome = await mapper.map(
      [
        { index: 0, improvement: 'a', recommendation: 'b' },
        { index: 1, improvement: 'c', recommendation: null },
      ],
      { sessionId: target.sessionId, userId: target.userId },
    );

    expect(llm.complete).toHaveBeenCalledTimes(1);
    const request = llm.complete.mock.calls[0][0];
    expect(request).toMatchObject({
      taskId: FEEDBACK_SKILL_MAPPER_TASK_ID,
      task: LlmTask.FEEDBACK_IMPROVEMENT_SKILL_MAPPING,
      model: FEEDBACK_SKILL_MAPPER_MODEL,
      temperature: 0,
      jsonMode: true,
      scenarioSessionId: target.sessionId,
      usageMetadata: {
        mapperVersion: FEEDBACK_SKILL_MAPPER_VERSION,
        sessionId: target.sessionId,
        items: 2,
      },
    });
    expect(outcome).toEqual({
      items: [
        { index: 0, skill: 'feelings' },
        { index: 1, skill: null },
      ],
      invalidKeys: 0,
      model: FEEDBACK_SKILL_MAPPER_MODEL,
      promptTokens: 3400,
      completionTokens: 60,
    });
  });

  it('throws on a reply that skips an item, so the attempt is recorded and retried', async () => {
    const mapper = new FeedbackSkillMapperService(
      llmReturning('{"items":[{"index":1,"skill":"verbal"}]}') as any,
    );
    await expect(
      mapper.map(
        [
          { index: 0, improvement: 'a', recommendation: null },
          { index: 1, improvement: 'b', recommendation: null },
        ],
        { sessionId: target.sessionId, userId: target.userId },
      ),
    ).rejects.toThrow('omitted 1 of 2');
  });
});

describe('the AI task registry row', () => {
  const row = AI_TASK_REGISTRY.find(
    (r) => r.id === FEEDBACK_SKILL_MAPPER_TASK_ID,
  );

  it('exists, carries the task label, and names the pinned model', () => {
    expect(row).toBeDefined();
    expect(row?.task).toBe(LlmTask.FEEDBACK_IMPROVEMENT_SKILL_MAPPING);
    expect(row?.defaultModel).toBe(FEEDBACK_SKILL_MAPPER_MODEL);
    expect(row?.detail).toContain(FEEDBACK_SKILL_MAPPING_SCHEDULE_ENV);
  });

  it('never falls back: a substitute model would file history under different skills', () => {
    expect(
      callConfigForAiTask(FEEDBACK_SKILL_MAPPER_TASK_ID, {
        modelIsExplicit: true,
      }).neverFallback,
    ).toBe(true);
  });

  it('is analysis spend, never part of what a session costs to deliver', () => {
    expect(
      SESSION_COST_COMPONENT_BY_TASK[
        LlmTask.FEEDBACK_IMPROVEMENT_SKILL_MAPPING
      ],
    ).toBeUndefined();
    expect(
      TASK_AREA[LlmTask.FEEDBACK_IMPROVEMENT_SKILL_MAPPING],
    ).toBeUndefined();
  });
});

describe('FeedbackSkillMappingService', () => {
  const repository = () => ({
    findSessionsToMap: jest.fn().mockResolvedValue([]),
    loadDebriefs: jest.fn().mockResolvedValue(new Map()),
    upsertLink: jest.fn().mockResolvedValue(undefined),
  });

  it('stores MAPPED with skill keys by position, the model and tokens — never the text', async () => {
    const repo = repository();
    const mapper = {
      map: jest.fn().mockResolvedValue({
        items: [
          { index: 0, skill: 'feelings' },
          { index: 1, skill: null },
        ],
        invalidKeys: 0,
        model: FEEDBACK_SKILL_MAPPER_MODEL,
        promptTokens: 3400,
        completionTokens: 60,
      }),
    };
    const service = new FeedbackSkillMappingService(repo as any, mapper as any);

    await expect(service.mapSession(target, debrief)).resolves.toBe(
      FeedbackSkillLinkStatus.MAPPED,
    );
    const write = repo.upsertLink.mock.calls[0][0];
    expect(write).toEqual({
      sessionId: target.sessionId,
      userId: 42,
      tenantId: 'tenant-a',
      sessionEndedAt: target.endedAt,
      mapperVersion: FEEDBACK_SKILL_MAPPER_VERSION,
      status: FeedbackSkillLinkStatus.MAPPED,
      itemCount: 2,
      items: [
        { index: 0, skill: 'feelings' },
        { index: 1, skill: null },
      ],
      model: FEEDBACK_SKILL_MAPPER_MODEL,
      promptTokens: 3400,
      completionTokens: 60,
      error: null,
    });
    expect(JSON.stringify(write)).not.toContain('improvement one');
    expect(JSON.stringify(write)).not.toContain('recommendation one');
  });

  it('stores SKIPPED with no model call when the debrief has nothing to map', async () => {
    const repo = repository();
    const mapper = { map: jest.fn() };
    const service = new FeedbackSkillMappingService(repo as any, mapper as any);

    await expect(
      service.mapSession(target, { areasOfGrowth: [{ improvement: ' ' }] }),
    ).resolves.toBe(FeedbackSkillLinkStatus.SKIPPED);
    expect(mapper.map).not.toHaveBeenCalled();
    expect(repo.upsertLink.mock.calls[0][0]).toMatchObject({
      status: FeedbackSkillLinkStatus.SKIPPED,
      itemCount: 0,
      items: [],
      model: null,
      error: 'Debrief has no improvement with any text',
    });
  });

  it('stores SKIPPED with no model call for a malformed, over-long list', async () => {
    const repo = repository();
    const mapper = { map: jest.fn() };
    const service = new FeedbackSkillMappingService(repo as any, mapper as any);
    const many = Array.from(
      { length: FEEDBACK_SKILL_MAPPER_MAX_ITEMS + 1 },
      (_, i) => `item ${i}`,
    );

    await expect(
      service.mapSession(target, { improvements: many }),
    ).resolves.toBe(FeedbackSkillLinkStatus.SKIPPED);
    expect(mapper.map).not.toHaveBeenCalled();
    expect(repo.upsertLink.mock.calls[0][0].itemCount).toBe(
      FEEDBACK_SKILL_MAPPER_MAX_ITEMS + 1,
    );
  });

  it('stores FAILED with the reason when the call throws, and never throws itself', async () => {
    const repo = repository();
    const mapper = {
      map: jest
        .fn()
        .mockRejectedValue(new Error('Mapper reply omitted 1 of 2 items')),
    };
    const service = new FeedbackSkillMappingService(repo as any, mapper as any);

    await expect(service.mapSession(target, debrief)).resolves.toBe(
      FeedbackSkillLinkStatus.FAILED,
    );
    expect(repo.upsertLink.mock.calls[0][0]).toMatchObject({
      status: FeedbackSkillLinkStatus.FAILED,
      itemCount: 2,
      items: [],
      model: null,
      error: 'Mapper reply omitted 1 of 2 items',
    });
  });

  it('survives a failing FAILED write', async () => {
    const repo = repository();
    repo.upsertLink.mockRejectedValue(new Error('db down'));
    const mapper = { map: jest.fn().mockRejectedValue(new Error('timeout')) };
    const service = new FeedbackSkillMappingService(repo as any, mapper as any);

    await expect(service.mapSession(target, debrief)).resolves.toBe(
      FeedbackSkillLinkStatus.FAILED,
    );
  });

  it('asks for the current versions and the per-tick cap, then maps each queued session once', async () => {
    const repo = repository();
    const second = {
      ...target,
      sessionId: '00000000-0000-4000-8000-000000000002',
    };
    repo.findSessionsToMap.mockResolvedValue([target, second]);
    repo.loadDebriefs.mockResolvedValue(
      new Map<string, unknown>([
        [target.sessionId, debrief],
        [second.sessionId, { areasOfGrowth: [] }],
      ]),
    );
    const mapper = {
      map: jest.fn().mockResolvedValue({
        items: [
          { index: 0, skill: 'verbal' },
          { index: 1, skill: 'goals' },
        ],
        invalidKeys: 0,
        model: FEEDBACK_SKILL_MAPPER_MODEL,
        promptTokens: 1,
        completionTokens: 1,
      }),
    };
    const service = new FeedbackSkillMappingService(repo as any, mapper as any);

    await expect(service.tick()).resolves.toEqual({
      sessionsMapped: 1,
      sessionsSkipped: 1,
      sessionsFailed: 0,
    });
    expect(repo.findSessionsToMap).toHaveBeenCalledWith(
      FEEDBACK_SKILL_MAPPER_VERSION,
      FHS_RUBRIC_VERSION,
      FHS_MAX_ATTEMPTS,
      FEEDBACK_SKILL_MAPPINGS_PER_TICK,
    );
    expect(repo.loadDebriefs).toHaveBeenCalledWith([
      target.sessionId,
      second.sessionId,
    ]);
    expect(mapper.map).toHaveBeenCalledTimes(1);
    expect(repo.upsertLink).toHaveBeenCalledTimes(2);
  });

  it('does nothing — no debrief read, no call — when the queue is empty', async () => {
    const repo = repository();
    const mapper = { map: jest.fn() };
    const service = new FeedbackSkillMappingService(repo as any, mapper as any);

    await service.tick();
    expect(repo.loadDebriefs).not.toHaveBeenCalled();
    expect(mapper.map).not.toHaveBeenCalled();
  });
});

describe('FeedbackSkillMappingRepository.findSessionsToMap — who gets mapped', () => {
  const run = async () => {
    const query = jest.fn().mockResolvedValue([
      {
        session_id: target.sessionId,
        user_id: '42',
        tenant_id: null,
        ended_at: '2026-09-01T10:00:00Z',
        attempts: '1',
      },
    ]);
    const repository = new FeedbackSkillMappingRepository({
      query,
    } as unknown as DataSource);
    const rows = await repository.findSessionsToMap('v1', 'fhs-v', 3, 20);
    const [sql, params] = query.mock.calls[0];
    return { rows, sql: String(sql).replace(/\s+/g, ' '), params };
  };

  it('binds versions, attempt cap and limit as parameters, oldest session first', async () => {
    const { rows, sql, params } = await run();
    expect(params).toEqual(['v1', 'fhs-v', 3, 20]);
    expect(sql).toContain('ORDER BY s."endedAt", s.id LIMIT $4');
    expect(rows).toEqual([
      {
        sessionId: target.sessionId,
        userId: 42,
        tenantId: null,
        endedAt: new Date('2026-09-01T10:00:00Z'),
        attempts: 1,
      },
    ]);
  });

  it('takes only completed, settled, countable sessions outside test orgs', async () => {
    const { sql } = await run();
    expect(sql).toContain(`s.status = 'ENDED'`);
    expect(sql).toContain(`s."eventStatus" = 'COMPLETED'`);
    expect(sql).toContain(`s."endedAt" < now() - make_interval(mins =>`);
    expect(sql).toContain(`s."roomId" NOT LIKE 'preview-%'`);
    expect(sql).toContain(`s."roomId" NOT LIKE 'seed-room-%'`);
    expect(sql).toContain(`(s.metadata->>'v2vTest')::boolean, false) = false`);
    expect(sql).toContain('"isTestOrganization" = true');
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM tenants tt');
  });

  it('takes only debriefs with an improvement, of learners with a scored cut under the pinned rubric', async () => {
    const { sql } = await run();
    expect(sql).toContain(`d.summary->'feedback'->'areasOfGrowth'`);
    expect(sql).toContain(`d.summary->'feedback'->'improvements'`);
    expect(sql).toMatch(/ELSE 0 END\) END\) > 0/);
    expect(sql).toContain(
      `WHERE fsc."userId" = s."counselorId" AND fsa."rubricVersion" = $2 AND fsa.status = 'SCORED' AND fsa."compositeScore" IS NOT NULL`,
    );
  });

  it('retries only FAILED rows under the cap, no more than hourly; MAPPED and SKIPPED are final', async () => {
    const { sql } = await run();
    expect(sql).toContain(`l."mapperVersion" = $1`);
    expect(sql).toContain(
      `(l.id IS NULL OR (l.status = 'FAILED' AND l.attempts < $3 AND l."updatedAt" < now() - interval '1 hour'))`,
    );
  });

  it('never selects the debrief text', async () => {
    const { sql } = await run();
    expect(sql).not.toMatch(/SELECT[^]*summary[^]*FROM scenario_sessions/);
  });
});

describe('FeedbackSkillMappingSchedulerRegistrationService', () => {
  const original = process.env[FEEDBACK_SKILL_MAPPING_SCHEDULE_ENV];
  afterEach(() => {
    if (original === undefined)
      delete process.env[FEEDBACK_SKILL_MAPPING_SCHEDULE_ENV];
    else process.env[FEEDBACK_SKILL_MAPPING_SCHEDULE_ENV] = original;
  });

  it('is OFF by default: no tick, no query, no model call', async () => {
    delete process.env[FEEDBACK_SKILL_MAPPING_SCHEDULE_ENV];
    const service = { tick: jest.fn() };
    const registration = new FeedbackSkillMappingSchedulerRegistrationService(
      service as any,
    );

    expect(FeedbackSkillMappingSchedulerRegistrationService.enabled()).toBe(
      false,
    );
    await registration.run();
    expect(service.tick).not.toHaveBeenCalled();
  });

  it.each(['off', 'false', '0', 'yes', ''])(
    'stays off for %p',
    async (value) => {
      process.env[FEEDBACK_SKILL_MAPPING_SCHEDULE_ENV] = value;
      expect(FeedbackSkillMappingSchedulerRegistrationService.enabled()).toBe(
        false,
      );
    },
  );

  it.each(['on', 'ON', ' true ', '1'])(
    'runs a tick when set to %p',
    async (value) => {
      process.env[FEEDBACK_SKILL_MAPPING_SCHEDULE_ENV] = value;
      const service = { tick: jest.fn().mockResolvedValue(undefined) };
      await new FeedbackSkillMappingSchedulerRegistrationService(
        service as any,
      ).run();
      expect(service.tick).toHaveBeenCalledTimes(1);
    },
  );

  it('swallows a failing tick so the rest of the bucket still runs', async () => {
    process.env[FEEDBACK_SKILL_MAPPING_SCHEDULE_ENV] = 'on';
    const service = { tick: jest.fn().mockRejectedValue(new Error('boom')) };
    await expect(
      new FeedbackSkillMappingSchedulerRegistrationService(
        service as any,
      ).run(),
    ).resolves.toBeUndefined();
  });
});
