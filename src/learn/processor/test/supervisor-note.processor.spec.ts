import { Test, TestingModule } from '@nestjs/testing';
import { SupervisorNoteProcessor } from '../supervisor-note.processor';
import { ScenarioSessionService } from '../../service/scenario-session.service';
import { LoggerService } from '../../../logger/logger.service';
import { LearnMessageAndEventMessage } from '../../interface/learn-message.interface';

describe('SupervisorNoteProcessor', () => {
  let processor: SupervisorNoteProcessor;
  let scenarioSessionService: {
    getScenarioSessionByRoomIdOrNull: jest.Mock;
    addSupervisorNote: jest.Mock;
  };

  const supervisorNote = {
    note: 'She just named a fear. Acknowledge it before moving to options.',
    seq: 1,
    turn_index: 4,
    language: 'ta-IN',
  };

  const message = (
    overrides: Partial<LearnMessageAndEventMessage> = {},
  ): LearnMessageAndEventMessage =>
    ({
      message_type: 'supervisor_note',
      room_id: 'ss_room-123',
      timestamp: 1_700_000_000,
      data: { supervisor_note: supervisorNote },
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
      addSupervisorNote: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupervisorNoteProcessor,
        { provide: ScenarioSessionService, useValue: scenarioSessionService },
      ],
    }).compile();

    processor = module.get<SupervisorNoteProcessor>(SupervisorNoteProcessor);
  });

  afterEach(() => jest.clearAllMocks());

  it('registers under the supervisor_note event type', () => {
    expect(processor.getEventType()).toBe('supervisor_note');
  });

  it('persists the note when the session exists', async () => {
    const session = { id: 'sess-1', tenantId: 't1', roomId: 'ss_room-123' };
    scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
      session,
    );

    await processor.process(message());

    expect(scenarioSessionService.addSupervisorNote).toHaveBeenCalledWith(
      session,
      supervisorNote,
    );
  });

  it('skips preview rooms without touching the session lookup', async () => {
    await processor.process(message({ room_id: 'preview-abc' }));

    expect(
      scenarioSessionService.getScenarioSessionByRoomIdOrNull,
    ).not.toHaveBeenCalled();
    expect(scenarioSessionService.addSupervisorNote).not.toHaveBeenCalled();
  });

  it('drops a note whose session cannot be resolved rather than throwing', async () => {
    // A note racing session teardown: the learner already saw it, so failing
    // the SQS message would only cause pointless redelivery.
    scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
      null,
    );

    await expect(processor.process(message())).resolves.toBeUndefined();
    expect(scenarioSessionService.addSupervisorNote).not.toHaveBeenCalled();
  });

  it('drops an empty note', async () => {
    await processor.process(
      message({ data: { supervisor_note: { note: '   ', seq: 2 } } }),
    );

    expect(
      scenarioSessionService.getScenarioSessionByRoomIdOrNull,
    ).not.toHaveBeenCalled();
  });

  it.each([[0], [-1], [undefined], [1.5]])(
    'drops a note with unusable seq %p, since seq is the idempotency key',
    async (seq) => {
      await processor.process(
        message({
          data: {
            supervisor_note: { note: 'Slow down here.', seq: seq as any },
          },
        }),
      );

      expect(
        scenarioSessionService.getScenarioSessionByRoomIdOrNull,
      ).not.toHaveBeenCalled();
    },
  );

  it('rethrows a persistence failure so SQS retries', async () => {
    scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue({
      id: 'sess-1',
      tenantId: 't1',
      roomId: 'ss_room-123',
    });
    scenarioSessionService.addSupervisorNote.mockRejectedValue(
      new Error('db down'),
    );

    await expect(processor.process(message())).rejects.toThrow('db down');
  });
});
