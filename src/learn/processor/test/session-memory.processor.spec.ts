import { Test, TestingModule } from '@nestjs/testing';
import { SessionMemoryProcessor } from '../session-memory.processor';
import { ScenarioSessionService } from '../../service/scenario-session.service';
import { LoggerService } from '../../../logger/logger.service';
import { LearnMessageAndEventMessage } from '../../interface/learn-message.interface';

describe('SessionMemoryProcessor', () => {
  let processor: SessionMemoryProcessor;
  let scenarioSessionService: {
    getScenarioSessionByRoomIdOrNull: jest.Mock;
    addSessionMemory: jest.Mock;
  };

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionMemoryProcessor,
        { provide: ScenarioSessionService, useValue: scenarioSessionService },
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

  it('skips preview rooms without touching the DB', async () => {
    await processor.process(message({ room_id: 'preview-xyz' }));

    expect(
      scenarioSessionService.getScenarioSessionByRoomIdOrNull,
    ).not.toHaveBeenCalled();
    expect(scenarioSessionService.addSessionMemory).not.toHaveBeenCalled();
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
});
