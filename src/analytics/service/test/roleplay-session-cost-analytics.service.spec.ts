import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { RoleplaySessionCostAnalyticsService } from '../roleplay-session-cost-analytics.service';
import { LlmTask } from '../../../learn/enum/llm-task.enum';
import {
  CoverageRow,
  RoleplaySessionCostAnalyticsRepository,
  SessionBucketRow,
  SessionUsageRow,
} from '../../repository/roleplay-session-cost-analytics.repository';
import {
  SESSION_COST_COMPONENT_BY_TASK,
  SESSION_COST_COMPONENTS,
} from '../../constants/session-cost.constants';

const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');

/**
 * gpt-4o-mini is $0.15/1M input, so 1M prompt tokens is exactly $0.15 — a round
 * number to assert against.
 */
const llmRow = (overrides: Partial<SessionUsageRow> = {}): SessionUsageRow => ({
  bucket: '2024-05-01',
  task: LlmTask.AGENT_TURN,
  service: 'llm',
  provider: 'openai',
  model: 'gpt-4o-mini',
  promptTokens: 1_000_000,
  completionTokens: 0,
  audioMs: 0,
  characters: 0,
  calls: 10,
  ...overrides,
});

const FULL_COVERAGE: CoverageRow = {
  liveFrom: new Date('2024-04-10T00:00:00.000Z'),
  debriefFrom: new Date('2024-04-20T09:00:00.000Z'),
};

describe('RoleplaySessionCostAnalyticsService', () => {
  let service: RoleplaySessionCostAnalyticsService;
  let repo: Record<string, jest.Mock>;

  const setup = async ({
    usage = [] as SessionUsageRow[],
    sessions = [] as SessionBucketRow[],
    coverage = FULL_COVERAGE,
  } = {}) => {
    repo = {
      getDataFloor: jest
        .fn()
        .mockResolvedValue(new Date('2024-01-01T00:00:00.000Z')),
      getSessionsByBucket: jest.fn().mockResolvedValue(sessions),
      getUsageByBucket: jest.fn().mockResolvedValue(usage),
      getCoverage: jest.fn().mockResolvedValue(coverage),
      getSession: jest.fn(),
      getSessionUsage: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleplaySessionCostAnalyticsService,
        { provide: RoleplaySessionCostAnalyticsRepository, useValue: repo },
      ],
    }).compile();
    service = module.get(RoleplaySessionCostAnalyticsService);
  };

  beforeEach(() => {
    jest.useFakeTimers({ now: FIXED_NOW });
  });
  afterEach(() => jest.useRealTimers());

  it('divides delivery cost by the minutes of the sessions started in the bucket', async () => {
    await setup({
      usage: [llmRow()],
      sessions: [{ bucket: '2024-05-01', sessions: 3, minutes: 30 }],
    });

    const res = await service.getRoleplaySessionCost({
      range: 'all',
      bucket: 'month',
    });
    const may = res.points.find((p) => p.bucket === '2024-05-01')!;

    expect(may.costUsd).toBeCloseTo(0.15, 6);
    expect(may.minutes).toBe(30);
    expect(may.sessions).toBe(3);
    expect(may.costPerMinuteUsd).toBeCloseTo(0.005, 6);
    expect(may.costPerSessionUsd).toBeCloseTo(0.05, 6);
  });

  it('stacks components so they sum to the headline per-minute cost', async () => {
    await setup({
      usage: [
        llmRow(),
        llmRow({ task: LlmTask.THINKING_FILLER, promptTokens: 200_000 }),
        llmRow({ task: LlmTask.BINARY_CLASSIFIER, promptTokens: 400_000 }),
        llmRow({ task: LlmTask.SCENARIO_EVALUATION, promptTokens: 400_000 }),
      ],
      sessions: [{ bucket: '2024-05-01', sessions: 1, minutes: 10 }],
    });

    const res = await service.getRoleplaySessionCost({
      range: 'all',
      bucket: 'month',
    });
    const may = res.points.find((p) => p.bucket === '2024-05-01')!;

    expect(may.perMinuteByComponent.dialogue).toBeCloseTo(0.015, 6);
    expect(may.perMinuteByComponent.fillers).toBeCloseTo(0.003, 6);
    expect(may.perMinuteByComponent.events).toBeCloseTo(0.006, 6);
    expect(may.perMinuteByComponent.debrief).toBeCloseTo(0.006, 6);
    const stack = SESSION_COST_COMPONENTS.reduce(
      (sum, c) => sum + (may.perMinuteByComponent[c] ?? 0),
      0,
    );
    expect(stack).toBeCloseTo(may.costPerMinuteUsd!, 6);
  });

  it('reports analysis spend beside the cost, never in it', async () => {
    await setup({
      usage: [
        llmRow(),
        llmRow({ task: LlmTask.ACTOR_EVALUATION }),
        llmRow({ task: LlmTask.DRIFT_JUDGE }),
      ],
      sessions: [{ bucket: '2024-05-01', sessions: 1, minutes: 10 }],
    });

    const res = await service.getRoleplaySessionCost({
      range: 'all',
      bucket: 'month',
    });
    const may = res.points.find((p) => p.bucket === '2024-05-01')!;

    expect(may.costUsd).toBeCloseTo(0.15, 6);
    expect(may.excludedCostUsd).toBeCloseTo(0.3, 6);
    expect(res.overall.excludedCostUsd).toBeCloseTo(0.3, 6);
  });

  it('prices speech-to-text and text-to-speech into their own components', async () => {
    await setup({
      usage: [
        llmRow({
          task: LlmTask.AGENT_STT,
          service: 'stt',
          provider: 'deepgram',
          model: 'nova-3',
          promptTokens: 0,
          audioMs: 60_000,
        }),
      ],
      sessions: [{ bucket: '2024-05-01', sessions: 1, minutes: 1 }],
    });

    const res = await service.getRoleplaySessionCost({
      range: 'all',
      bucket: 'month',
    });
    const may = res.points.find((p) => p.bucket === '2024-05-01')!;

    expect(may.costByComponent.stt).toBeGreaterThan(0);
    expect(may.costByComponent.dialogue).toBe(0);
  });

  it('has no ratio over zero minutes, but still counts the cost of a session that never got going', async () => {
    await setup({
      usage: [llmRow()],
      sessions: [{ bucket: '2024-05-01', sessions: 2, minutes: 0 }],
    });

    const res = await service.getRoleplaySessionCost({
      range: 'all',
      bucket: 'month',
    });
    const may = res.points.find((p) => p.bucket === '2024-05-01')!;

    expect(may.costUsd).toBeCloseTo(0.15, 6);
    expect(may.costPerMinuteUsd).toBeNull();
    expect(may.perMinuteByComponent.dialogue).toBeNull();
    expect(may.costPerSessionUsd).toBeCloseTo(0.075, 6);
  });

  it('gap-fills quiet buckets with zero cost and a null ratio', async () => {
    await setup();

    const res = await service.getRoleplaySessionCost({
      range: 'all',
      bucket: 'month',
    });

    expect(res.points.length).toBeGreaterThan(1);
    for (const p of res.points) {
      expect(p.costUsd).toBe(0);
      expect(p.costPerMinuteUsd).toBeNull();
    }
  });

  it('computes the whole-window ratio from totals, not by averaging buckets', async () => {
    await setup({
      usage: [
        llmRow({ bucket: '2024-04-01' }),
        llmRow({ bucket: '2024-05-01' }),
      ],
      sessions: [
        { bucket: '2024-04-01', sessions: 1, minutes: 10 },
        { bucket: '2024-05-01', sessions: 9, minutes: 90 },
      ],
    });

    const res = await service.getRoleplaySessionCost({
      range: 'all',
      bucket: 'month',
    });

    // $0.30 over 100 minutes — NOT the mean of 0.015 and 0.00167.
    expect(res.overall.costPerMinuteUsd).toBeCloseTo(0.003, 6);
    expect(res.overall.sessions).toBe(10);
  });

  it('counts unpriced delivery calls', async () => {
    await setup({
      usage: [llmRow({ model: 'no-such-model', calls: 4 })],
      sessions: [{ bucket: '2024-05-01', sessions: 1, minutes: 10 }],
    });

    const res = await service.getRoleplaySessionCost({
      range: 'all',
      bucket: 'month',
    });

    expect(res.overall.unpricedCalls).toBe(4);
  });

  describe('coverage cutover', () => {
    it('marks buckets that start before full coverage as partial', async () => {
      await setup();

      const res = await service.getRoleplaySessionCost({
        range: 'all',
        bucket: 'month',
      });
      const byBucket = new Map(res.points.map((p) => [p.bucket, p.partial]));

      // Cutover is the LATER half: 2024-04-20.
      expect(res.fullCoverageFrom).toBe('2024-04-20T09:00:00.000Z');
      expect(byBucket.get('2024-03-01')).toBe(true);
      expect(byBucket.get('2024-04-01')).toBe(true);
      expect(byBucket.get('2024-05-01')).toBe(false);
    });

    it('treats every bucket as partial until both halves have shipped', async () => {
      await setup({
        coverage: { liveFrom: FULL_COVERAGE.liveFrom, debriefFrom: null },
      });

      const res = await service.getRoleplaySessionCost({
        range: 'all',
        bucket: 'month',
      });

      expect(res.fullCoverageFrom).toBeNull();
      expect(res.points.every((p) => p.partial)).toBe(true);
    });
  });

  describe('getSessionCost', () => {
    it('itemises one session, most expensive line first, with analysis lines marked', async () => {
      await setup();
      repo.getSession.mockResolvedValue({
        id: 's-1',
        createdAt: new Date('2024-05-02T10:00:00.000Z'),
        minutes: 10,
        status: 'COMPLETED',
        eventStatus: 'COMPLETED',
      });
      const row = { ...llmRow() } as Partial<SessionUsageRow>;
      delete row.bucket;
      repo.getSessionUsage.mockResolvedValue([
        { ...row, task: LlmTask.ACTOR_EVALUATION, promptTokens: 100_000 },
        row,
      ]);

      const res = await service.getSessionCost('s-1');

      expect(res.costUsd).toBeCloseTo(0.15, 6);
      expect(res.costPerMinuteUsd).toBeCloseTo(0.015, 6);
      expect(res.excludedCostUsd).toBeCloseTo(0.015, 6);
      expect(res.fullyLogged).toBe(true);
      expect(res.lines[0].task).toBe(LlmTask.AGENT_TURN);
      expect(res.lines[0].component).toBe('dialogue');
      expect(res.lines[1].component).toBeNull();
    });

    it('404s an unknown session', async () => {
      await setup();
      repo.getSession.mockResolvedValue(null);
      repo.getSessionUsage.mockResolvedValue([]);

      await expect(service.getSessionCost('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  it('classifies every live-session and debrief delivery task', () => {
    const delivery = [
      LlmTask.AGENT_TURN,
      LlmTask.AGENT_STT,
      LlmTask.AGENT_TTS,
      LlmTask.CLIP_TTS,
      LlmTask.INTERIM_REPLY,
      LlmTask.THINKING_FILLER,
      LlmTask.BACKCHANNEL_PHRASES,
      LlmTask.SUPERVISOR_NOTE,
      LlmTask.CLIENT_WORKING_MEMORY,
      LlmTask.SCENARIO_EVALUATION,
      LlmTask.DEBRIEF_CHAT,
      LlmTask.TRACK_MEMORY_FOLD,
    ];
    for (const t of delivery) {
      expect(SESSION_COST_COMPONENT_BY_TASK[t]).toBeDefined();
    }
    for (const t of [
      LlmTask.ACTOR_EVALUATION,
      LlmTask.DRIFT_JUDGE,
      LlmTask.AUTOFILL_FIELD,
    ]) {
      expect(SESSION_COST_COMPONENT_BY_TASK[t]).toBeUndefined();
    }
  });
});
