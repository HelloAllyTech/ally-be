import { Test, TestingModule } from '@nestjs/testing';
import { SessionMemoryProcessor } from '../session-memory.processor';
import { ScenarioSessionService } from '../../service/scenario-session.service';
import { TrackMemoryService } from 'src/track/service/track-memory.service';
import { TrackProgressService } from 'src/track/service/track-progress.service';
import { CaseSharedService } from 'src/case/service/case-shared.service';
import { PreviewMonologueService } from '../../service/preview-monologue.service';
import { LoggerService } from '../../../logger/logger.service';
import { LearnMessageAndEventMessage } from '../../interface/learn-message.interface';

describe('SessionMemoryProcessor', () => {
  let processor: SessionMemoryProcessor;
  let scenarioSessionService: {
    getScenarioSessionByRoomIdOrNull: jest.Mock;
    addSessionMemory: jest.Mock;
  };
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
      addSessionMemory: jest.fn().mockResolvedValue(undefined),
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
});
