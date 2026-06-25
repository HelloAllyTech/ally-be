import { NotFoundException } from '@nestjs/common';
import { RoleplaySessionLogsService } from '../roleplay-session-logs.service';
import { RoleplaySessionLogsRepository } from '../../repository/roleplay-session-logs.repository';
import { ScenarioSessionStatus } from '../../../learn/enum/scenario-session-status.enum';

describe('RoleplaySessionLogsService', () => {
  let service: RoleplaySessionLogsService;
  let repo: jest.Mocked<RoleplaySessionLogsRepository>;

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
  };

  beforeEach(() => {
    repo = {
      list: jest.fn(),
      findOne: jest.fn(),
      findSummary: jest.fn(),
      findEvents: jest.fn(),
      findTranscript: jest.fn(),
    } as unknown as jest.Mocked<RoleplaySessionLogsRepository>;

    service = new RoleplaySessionLogsService(repo);
  });

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
  });
});
