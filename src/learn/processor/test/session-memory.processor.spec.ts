import { Test, TestingModule } from '@nestjs/testing';
import {
  PARTIAL_MEMORY_FOLD_DELAY_MS,
  SessionMemoryProcessor,
  TRACK_MEMORY_FOLD_GUARD_TTL_SECONDS,
  isFinalSessionMemory,
} from '../session-memory.processor';
import { ScenarioSessionService } from '../../service/scenario-session.service';
import { TrackMemoryService } from 'src/track/service/track-memory.service';
import { TrackProgressService } from 'src/track/service/track-progress.service';
import { CaseSharedService } from 'src/case/service/case-shared.service';
import { PreviewMonologueService } from '../../service/preview-monologue.service';
import { RedisService } from 'src/redis/service/redis.service';
import { LoggerService } from '../../../logger/logger.service';
import { LearnMessageAndEventMessage } from '../../interface/learn-message.interface';

describe('SessionMemoryProcessor', () => {
  let processor: SessionMemoryProcessor;
  let scenarioSessionService: {
    getScenarioSessionByRoomIdOrNull: jest.Mock;
    addSessionMemory: jest.Mock;
    getStoredSessionMemory: jest.Mock;
  };
  let redisService: { acquireLock: jest.Mock };
  /** The fold markers currently held — a stand-in for Redis SET NX. */
  let foldMarkers: Set<string>;
  let trackMemoryService: { foldSessionMemory: jest.Mock };
  let trackProgressService: { getProgressIdByCaseSessionId: jest.Mock };
  let caseSharedService: { getCaseSessionIdBySessionItemId: jest.Mock };
  let previewMonologueService: { recordMonologue: jest.Mock };

  const sessionMemory = {
    summary: 'Situation: discussed job loss. You disclosed: anxiety at night.',
    language: 'ta-IN',
    message_count: 24,
    summarized_message_count: 24,
  };

  const message = (overrides: Partial<LearnMessageAndEventMessage> = {}) =>
    ({
      message_type: 'session_memory',
      room_id: 'ss_room-123',
      timestamp: 1_700_000_000,
      data: { session_memory: sessionMemory },
      ...overrides,
    }) as LearnMessageAndEventMessage;

  beforeEach(async () => {
    jest.spyOn(LoggerService, 'getInstance').mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any);

    scenarioSessionService = {
      getScenarioSessionByRoomIdOrNull: jest.fn(),
      addSessionMemory: jest.fn().mockResolvedValue(true),
      getStoredSessionMemory: jest.fn().mockResolvedValue(null),
    };

    foldMarkers = new Set();
    redisService = {
      acquireLock: jest.fn(async (key: string) => {
        if (foldMarkers.has(key)) return false;
        foldMarkers.add(key);
        return true;
      }),
    };

    trackMemoryService = {
      foldSessionMemory: jest.fn().mockResolvedValue(undefined),
    };
    trackProgressService = {
      getProgressIdByCaseSessionId: jest.fn().mockResolvedValue(null),
    };
    caseSharedService = {
      getCaseSessionIdBySessionItemId: jest.fn().mockResolvedValue(null),
    };
    previewMonologueService = {
      recordMonologue: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionMemoryProcessor,
        { provide: ScenarioSessionService, useValue: scenarioSessionService },
        { provide: TrackMemoryService, useValue: trackMemoryService },
        { provide: TrackProgressService, useValue: trackProgressService },
        { provide: CaseSharedService, useValue: caseSharedService },
        {
          provide: PreviewMonologueService,
          useValue: previewMonologueService,
        },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    processor = module.get<SessionMemoryProcessor>(SessionMemoryProcessor);
  });

  afterEach(() => jest.clearAllMocks());

  it('registers under the session_memory event type', () => {
    expect(processor.getEventType()).toBe('session_memory');
  });

  it('persists memory with the agent timestamp when the session exists', async () => {
    const session = { id: 'sess-1', tenantId: 't1', roomId: 'ss_room-123' };
    scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
      session,
    );

    await processor.process(message());

    expect(scenarioSessionService.addSessionMemory).toHaveBeenCalledTimes(1);
    const [passedSession, passedMemory, receivedAt] =
      scenarioSessionService.addSessionMemory.mock.calls[0];
    expect(passedSession).toBe(session);
    expect(passedMemory).toBe(sessionMemory);
    expect(receivedAt).toEqual(new Date(1_700_000_000 * 1000));
  });

  it('skips preview rooms without touching the session tables', async () => {
    await processor.process(message({ room_id: 'preview-xyz' }));

    expect(
      scenarioSessionService.getScenarioSessionByRoomIdOrNull,
    ).not.toHaveBeenCalled();
    expect(scenarioSessionService.addSessionMemory).not.toHaveBeenCalled();
  });

  it('keeps the internal monologue from a preview run', async () => {
    const turns = [{ turn: 1 }, { turn: 2 }];

    await processor.process(
      message({
        room_id: 'preview-450-abc',
        data: {
          session_memory: {
            ...sessionMemory,
            structured: { client_working_memory: { monologue: turns } },
          },
        } as any,
      }),
    );

    expect(previewMonologueService.recordMonologue).toHaveBeenCalledWith(
      'preview-450-abc',
      turns,
    );
    // Still no session work: the monologue is the only thing a preview keeps.
    expect(scenarioSessionService.addSessionMemory).not.toHaveBeenCalled();
  });

  it('records nothing for a preview that produced no monologue', async () => {
    await processor.process(message({ room_id: 'preview-450-abc' }));

    expect(previewMonologueService.recordMonologue).not.toHaveBeenCalled();
  });

  it('leaves learner sessions out of the preview store', async () => {
    scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue({
      id: 'session-1',
    });

    await processor.process(
      message({
        data: {
          session_memory: {
            ...sessionMemory,
            structured: { client_working_memory: { monologue: [{ turn: 1 }] } },
          },
        } as any,
      }),
    );

    expect(previewMonologueService.recordMonologue).not.toHaveBeenCalled();
  });

  it('drops payloads with a missing or blank summary', async () => {
    await processor.process(
      message({ data: { session_memory: { summary: '   ' } } as any }),
    );

    expect(scenarioSessionService.addSessionMemory).not.toHaveBeenCalled();
  });

  it('no-ops when the session cannot be resolved', async () => {
    scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
      null,
    );

    await expect(processor.process(message())).resolves.toBeUndefined();
    expect(scenarioSessionService.addSessionMemory).not.toHaveBeenCalled();
  });

  it('rethrows persistence failures so SQS can retry', async () => {
    scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue({
      id: 'sess-1',
      tenantId: 't1',
    });
    scenarioSessionService.addSessionMemory.mockRejectedValue(
      new Error('db down'),
    );

    await expect(processor.process(message())).rejects.toThrow('db down');
  });

  describe('track memory fold trigger', () => {
    const flush = () => new Promise(setImmediate);

    it('folds when the session belongs to a track roleplay', async () => {
      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
        { id: 'sess-1', tenantId: 't1', trackItemProgressId: 'tip-1' },
      );

      await processor.process(message());
      await flush();

      expect(trackMemoryService.foldSessionMemory).toHaveBeenCalledWith({
        trackItemProgressId: 'tip-1',
        scenarioSessionId: 'sess-1',
        summary: sessionMemory.summary,
      });
    });

    it('folds through the case link for a case nested in a track', async () => {
      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
        { id: 'sess-2', tenantId: 't1', caseSessionItemId: 'csi-1' },
      );
      caseSharedService.getCaseSessionIdBySessionItemId.mockResolvedValue(
        'cs-1',
      );
      trackProgressService.getProgressIdByCaseSessionId.mockResolvedValue(
        'tip-case',
      );

      await processor.process(message());
      await flush();

      expect(trackMemoryService.foldSessionMemory).toHaveBeenCalledWith({
        trackItemProgressId: 'tip-case',
        scenarioSessionId: 'sess-2',
        summary: sessionMemory.summary,
      });
    });

    it('does not fold for sessions outside tracks', async () => {
      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
        { id: 'sess-3', tenantId: 't1' },
      );

      await processor.process(message());
      await flush();

      expect(trackMemoryService.foldSessionMemory).not.toHaveBeenCalled();
    });

    it('fold failures never fail the SQS message', async () => {
      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
        { id: 'sess-4', tenantId: 't1', trackItemProgressId: 'tip-1' },
      );
      trackMemoryService.foldSessionMemory.mockRejectedValue(
        new Error('fold boom'),
      );

      await expect(processor.process(message())).resolves.toBeUndefined();
      await flush();
    });
  });

  describe('folding each session once', () => {
    const flush = () => new Promise(setImmediate);
    const trackSession = {
      id: 'sess-9',
      tenantId: 't1',
      trackItemProgressId: 'tip-9',
    };
    const phase1 = {
      summary: 'Phase 1: maintained summary.',
      message_count: 30,
      summarized_message_count: 24,
      structured: { disclosures: ['phase-1 fact'] },
    };
    const phase2 = {
      summary: 'Phase 2: final compaction.',
      message_count: 30,
      summarized_message_count: 30,
      structured: { disclosures: ['phase-2 fact'] },
    };
    const deliver = (memory: Record<string, any>) =>
      processor.process(message({ data: { session_memory: memory } as any }));

    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['setImmediate'] });
      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
        trackSession,
      );
    });

    afterEach(() => jest.useRealTimers());

    it('does not fold a delivery the coverage guard refused to store', async () => {
      scenarioSessionService.addSessionMemory.mockResolvedValue(false);

      await deliver(phase2);
      await flush();
      jest.advanceTimersByTime(PARTIAL_MEMORY_FOLD_DELAY_MS);
      await flush();

      expect(trackMemoryService.foldSessionMemory).not.toHaveBeenCalled();
      expect(redisService.acquireLock).not.toHaveBeenCalled();
    });

    it('folds a full-coverage delivery immediately, claiming the session marker', async () => {
      await deliver(phase2);
      await flush();

      expect(redisService.acquireLock).toHaveBeenCalledWith(
        'track-memory-fold:sess-9',
        TRACK_MEMORY_FOLD_GUARD_TTL_SECONDS,
      );
      expect(trackMemoryService.foldSessionMemory).toHaveBeenCalledTimes(1);
      expect(trackMemoryService.foldSessionMemory).toHaveBeenCalledWith({
        trackItemProgressId: 'tip-9',
        scenarioSessionId: 'sess-9',
        summary: phase2.summary,
        disclosures: ['phase-2 fact'],
      });
    });

    it('defers a partial delivery, and phase 2 arriving in the window is the only fold', async () => {
      await deliver(phase1);
      await flush();
      expect(trackMemoryService.foldSessionMemory).not.toHaveBeenCalled();

      await deliver(phase2);
      await flush();
      expect(trackMemoryService.foldSessionMemory).toHaveBeenCalledTimes(1);

      // The phase-1 timer fires, finds the session already folded.
      scenarioSessionService.getStoredSessionMemory.mockResolvedValue({
        summary: phase2.summary,
        structured: phase2.structured,
      });
      jest.advanceTimersByTime(PARTIAL_MEMORY_FOLD_DELAY_MS);
      await flush();
      await flush();

      expect(trackMemoryService.foldSessionMemory).toHaveBeenCalledTimes(1);
      expect(trackMemoryService.foldSessionMemory).toHaveBeenCalledWith(
        expect.objectContaining({ summary: phase2.summary }),
      );
    });

    it('folds the stored memory once the window closes when no phase 2 comes', async () => {
      scenarioSessionService.getStoredSessionMemory.mockResolvedValue({
        summary: phase1.summary,
        structured: phase1.structured,
      });

      await deliver(phase1);
      await flush();
      jest.advanceTimersByTime(PARTIAL_MEMORY_FOLD_DELAY_MS - 1);
      await flush();
      expect(trackMemoryService.foldSessionMemory).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      await flush();
      await flush();

      expect(
        scenarioSessionService.getStoredSessionMemory,
      ).toHaveBeenCalledWith('sess-9', 't1');
      expect(trackMemoryService.foldSessionMemory).toHaveBeenCalledTimes(1);
      expect(trackMemoryService.foldSessionMemory).toHaveBeenCalledWith({
        trackItemProgressId: 'tip-9',
        scenarioSessionId: 'sess-9',
        summary: phase1.summary,
        disclosures: ['phase-1 fact'],
      });
    });

    it('never folds a session twice on redelivery', async () => {
      await deliver(phase2);
      await deliver(phase2);
      await flush();

      expect(trackMemoryService.foldSessionMemory).toHaveBeenCalledTimes(1);
    });

    it('two deferred deliveries fold once between them', async () => {
      scenarioSessionService.getStoredSessionMemory.mockResolvedValue({
        summary: phase1.summary,
      });
      const placeholder = {
        summary: '(no conversation summary was produced for this session)',
        message_count: 0,
        summarized_message_count: 0,
      };

      await deliver(placeholder);
      await deliver(phase1);
      await flush();
      jest.advanceTimersByTime(PARTIAL_MEMORY_FOLD_DELAY_MS);
      await flush();
      await flush();

      expect(trackMemoryService.foldSessionMemory).toHaveBeenCalledTimes(1);
      expect(trackMemoryService.foldSessionMemory).toHaveBeenCalledWith(
        expect.objectContaining({ summary: phase1.summary }),
      );
    });

    it('schedules nothing for a session outside any track', async () => {
      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
        { id: 'sess-10', tenantId: 't1' },
      );

      await deliver(phase1);
      await flush();
      jest.advanceTimersByTime(PARTIAL_MEMORY_FOLD_DELAY_MS);
      await flush();

      expect(
        scenarioSessionService.getStoredSessionMemory,
      ).not.toHaveBeenCalled();
      expect(redisService.acquireLock).not.toHaveBeenCalled();
    });

    it('folds anyway when the Redis marker cannot be reached', async () => {
      redisService.acquireLock.mockRejectedValue(new Error('redis down'));

      await deliver(phase2);
      await flush();

      expect(trackMemoryService.foldSessionMemory).toHaveBeenCalledTimes(1);
    });
  });

  describe('isFinalSessionMemory', () => {
    it.each([
      [{ message_count: 30, summarized_message_count: 30 }, true],
      [{ message_count: 30, summarized_message_count: 24 }, false],
      // An older agent that sends once per session carries no coverage.
      [{}, true],
      [{ message_count: 30 }, true],
      // The working-memory-only placeholder must not take the session's fold.
      [{ message_count: 0, summarized_message_count: 0 }, false],
    ])('%j -> %s', (coverage, expected) => {
      expect(isFinalSessionMemory({ summary: 's', ...coverage })).toBe(
        expected,
      );
    });
  });
});
