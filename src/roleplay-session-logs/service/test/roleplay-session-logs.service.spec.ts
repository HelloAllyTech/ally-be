import { NotFoundException } from '@nestjs/common';
import { RoleplaySessionLogsService } from '../roleplay-session-logs.service';
import { RoleplaySessionLogsRepository } from '../../repository/roleplay-session-logs.repository';
import { ScenarioSessionStatus } from '../../../learn/enum/scenario-session-status.enum';
import { S3Service } from '../../../aws/service/s3.service';
import { AppConfigService } from '../../../config/config.service';

describe('RoleplaySessionLogsService', () => {
  let service: RoleplaySessionLogsService;
  let repo: jest.Mocked<RoleplaySessionLogsRepository>;
  let s3Service: jest.Mocked<S3Service>;
  let configService: jest.Mocked<AppConfigService>;

  const baseRow = {
    id: 'sess-1',
    counselorId: '42',
    counselorName: 'Alice',
    counselorEmail: 'alice@org.com',
    tenantId: 'tenant-1',
    orgName: 'Org One',
    scenarioId: '7',
    scenarioTitle: 'Crisis call',
    status: ScenarioSessionStatus.ENDED,
    startedAt: new Date('2026-06-01T10:00:00Z'),
    endedAt: new Date('2026-06-01T10:05:00Z'),
    score: '88.5',
    platform: 'web',
    callDuration: null,
    totalPausedMs: '0',
    createdAt: new Date('2026-06-01T10:00:00Z'),
    isV2VTest: false,
  };

  beforeEach(() => {
    repo = {
      list: jest.fn(),
      findOne: jest.fn(),
      findSummary: jest.fn().mockResolvedValue(null),
      findEvents: jest.fn().mockResolvedValue([]),
      findTranscript: jest.fn().mockResolvedValue([]),
      getUsageBySessions: jest.fn().mockResolvedValue([]),
      getUsageBySession: jest.fn().mockResolvedValue([]),
      getLatencyBySession: jest.fn().mockResolvedValue({ turnCount: 0 }),
      getRecordingBySession: jest.fn().mockResolvedValue(null),
      getFeedbackBySession: jest.fn().mockResolvedValue(null),
      findAgentTestCases: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<RoleplaySessionLogsRepository>;

    s3Service = {
      generatePresignedUrl: jest
        .fn()
        .mockResolvedValue('https://s3.example.com/presigned'),
    } as unknown as jest.Mocked<S3Service>;

    configService = {
      scenarioSessionAudioStorage: { bucket: 'recordings-bucket' },
    } as unknown as jest.Mocked<AppConfigService>;

    service = new RoleplaySessionLogsService(repo, s3Service, configService);
  });

  const usageRows = [
    {
      scenarioSessionId: 'sess-1',
      service: 'llm',
      provider: 'openai',
      model: 'gpt-4o-mini',
      promptTokens: 200000,
      completionTokens: 100000,
      totalTokens: 300000,
      cachedTokens: 0,
      audioMs: 0,
      characters: 0,
      calls: 5,
    },
    {
      scenarioSessionId: 'sess-1',
      service: 'stt',
      provider: 'deepgram',
      model: 'nova-3',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      audioMs: 120000, // 2 minutes
      characters: 0,
      calls: 3,
    },
    {
      scenarioSessionId: 'sess-1',
      service: 'tts',
      provider: 'elevenlabs',
      model: 'voice-x',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      audioMs: 0,
      characters: 1000,
      calls: 4,
    },
  ];

  const zeroLatency = {
    turnCount: 0,
    avgResponseLatencyMs: null,
    p50ResponseLatencyMs: null,
    p95ResponseLatencyMs: null,
    avgEouDelayMs: null,
    avgLlmTtftMs: null,
    avgTtsTtfbMs: null,
    avgOrchestrationMs: null,
    avgLlmResponseMs: null,
    avgProsodyMs: null,
    avgBranchingMs: null,
    avgKnowledgeRetrievalMs: null,
    avgProcessEventsMs: null,
    avgBehaviorsMs: null,
    interruptedTurns: 0,
    llmTimedOutTurns: 0,
    prosodySkippedTurns: 0,
  };

  describe('list', () => {
    it('coerces string numerics and passes total through', async () => {
      repo.list.mockResolvedValue({ rows: [baseRow], total: 3 });

      const result = await service.list({});

      expect(result.total).toBe(3);
      const row = result.data[0];
      expect(row.counselorId).toBe(42);
      expect(row.scenarioId).toBe(7);
      expect(row.score).toBe(88.5);
      expect(row.orgName).toBe('Org One');
    });

    it('computes durationSeconds from the session window minus pauses', async () => {
      repo.list.mockResolvedValue({
        rows: [{ ...baseRow, callDuration: null, totalPausedMs: '60000' }],
        total: 1,
      });

      const { data } = await service.list({});
      // 5 min window (300s) minus 60s paused = 240s
      expect(data[0].durationSeconds).toBe(240);
    });

    it('prefers the agent-reported callDuration when present', async () => {
      repo.list.mockResolvedValue({
        rows: [{ ...baseRow, callDuration: '123' }],
        total: 1,
      });

      const { data } = await service.list({});
      expect(data[0].durationSeconds).toBe(123);
    });

    it('returns null duration when the session never ended', async () => {
      repo.list.mockResolvedValue({
        rows: [{ ...baseRow, callDuration: null, endedAt: null }],
        total: 1,
      });

      const { data } = await service.list({});
      expect(data[0].durationSeconds).toBeNull();
    });
  });

  describe('getById', () => {
    it('throws NotFoundException when the session does not exist', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.getById('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('assembles core + summary + events + transcript', async () => {
      repo.findOne.mockResolvedValue(baseRow);
      repo.findSummary.mockResolvedValue({ headline: 'good' });
      repo.findEvents.mockResolvedValue([
        {
          id: 'e1',
          eventId: 'ev-1',
          eventName: 'Empathy shown',
          occurredAt: new Date('2026-06-01T10:02:00Z'),
          score: '5',
          emoji: '😊',
          message: 'nice',
        },
      ]);
      repo.findTranscript.mockResolvedValue([
        {
          id: 10,
          senderId: 42,
          content: 'Hello',
          startSeconds: 1.5,
          endSeconds: 2.0,
          createdAt: new Date('2026-06-01T10:00:01Z'),
        },
      ]);

      const detail = await service.getById('sess-1');

      expect(detail.id).toBe('sess-1');
      expect(detail.summary).toEqual({ headline: 'good' });
      expect(detail.events).toHaveLength(1);
      expect(detail.events[0].score).toBe(5);
      expect(detail.events[0].eventName).toBe('Empathy shown');
      expect(detail.transcript).toHaveLength(1);
      expect(detail.transcript[0].content).toBe('Hello');
    });

    it('presigns a playback URL for the egress recording', async () => {
      repo.findOne.mockResolvedValue(baseRow);
      repo.getRecordingBySession.mockResolvedValue({
        storageKey: 'recordings/room-1.ogg',
        egressId: 'EG_123',
      });

      const detail = await service.getById('sess-1');

      expect(detail.recording).toEqual({
        storageKey: 'recordings/room-1.ogg',
        egressId: 'EG_123',
        url: 'https://s3.example.com/presigned',
      });
      expect(s3Service.generatePresignedUrl).toHaveBeenCalledWith({
        bucket: 'recordings-bucket',
        key: 'recordings/room-1.ogg',
        operation: 'get',
        expiresIn: 2400,
      });
    });

    it('returns the recording pointer with a null url when presigning fails', async () => {
      repo.findOne.mockResolvedValue(baseRow);
      repo.getRecordingBySession.mockResolvedValue({
        storageKey: 'recordings/room-1.ogg',
        egressId: 'EG_123',
      });
      s3Service.generatePresignedUrl.mockRejectedValue(new Error('boom'));

      const detail = await service.getById('sess-1');

      expect(detail.recording).toEqual({
        storageKey: 'recordings/room-1.ogg',
        egressId: 'EG_123',
        url: null,
      });
    });
  });

  describe('usage, cost, models & latency', () => {
    it('rolls up tokens and prices LLM/STT/TTS via the pricing tables', async () => {
      repo.findOne.mockResolvedValue(baseRow);
      repo.getUsageBySession.mockResolvedValue(usageRows);

      const detail = await service.getById('sess-1');

      expect(detail.usage).not.toBeNull();
      expect(detail.usage!.llmTotalTokens).toBe(300000);
      expect(detail.usage!.sttAudioMs).toBe(120000);
      expect(detail.usage!.ttsCharacters).toBe(1000);
      // 0.09 (llm) + 0.0154 (stt: 2min*0.0077) + 0.15 (tts: 1000/1e6*150) -> 0.26
      expect(detail.usage!.estimatedCostUsd).toBeCloseTo(0.26, 2);
      expect(detail.usage!.priced).toBe(true);
      expect(detail.models).toEqual({
        llm: [{ provider: 'openai', model: 'gpt-4o-mini' }],
        stt: [{ provider: 'deepgram', model: 'nova-3' }],
        tts: [{ provider: 'elevenlabs', model: 'voice-x' }],
      });
    });

    it('attaches per-row token + cost rollups in the list', async () => {
      repo.list.mockResolvedValue({ rows: [baseRow], total: 1 });
      repo.getUsageBySessions.mockResolvedValue(usageRows);

      const { data } = await service.list({});
      expect(data[0].totalTokens).toBe(300000);
      expect(data[0].estimatedCostUsd).toBeCloseTo(0.26, 2);
      expect(data[0].costPriced).toBe(true);
    });

    it('returns null latency with no pipeline turns, else aggregates', async () => {
      repo.findOne.mockResolvedValue(baseRow);
      const noTurns = await service.getById('sess-1');
      expect(noTurns.latency).toBeNull();

      repo.getLatencyBySession.mockResolvedValue({
        ...zeroLatency,
        turnCount: 10,
        avgResponseLatencyMs: 850,
        p50ResponseLatencyMs: 800,
        p95ResponseLatencyMs: 1500,
        interruptedTurns: 2,
      });
      const withTurns = await service.getById('sess-1');
      expect(withTurns.latency).toMatchObject({
        turnCount: 10,
        p95ResponseLatencyMs: 1500,
        interruptedTurns: 2,
      });
    });
  });

  describe('actor evaluation', () => {
    it('builds the evaluation block with pass/fail vs threshold', async () => {
      repo.findOne.mockResolvedValue({
        ...baseRow,
        compositeScore: 88,
        evalMetrics: { 'Build rapport': 86, 'Stay in character': 90 },
        evaluationStatus: 'COMPLETED',
        evaluationMarkdown: '## Summary\nSolid.',
        evaluatedAt: new Date('2026-06-01T10:06:00Z'),
      });

      const detail = await service.getById('sess-1');
      expect(detail.actorEvaluation).toMatchObject({
        compositeScore: 88,
        passThreshold: 90,
        pass: false, // 88 < 90
        status: 'COMPLETED',
      });
      expect(detail.actorEvaluation!.metrics).toEqual({
        'Build rapport': 86,
        'Stay in character': 90,
      });
    });

    it('is null when the session was never evaluated', async () => {
      repo.findOne.mockResolvedValue(baseRow);
      const detail = await service.getById('sess-1');
      expect(detail.actorEvaluation).toBeNull();
    });
  });
});
