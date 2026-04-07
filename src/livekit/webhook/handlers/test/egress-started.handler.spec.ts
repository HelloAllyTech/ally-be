import { Test, TestingModule } from '@nestjs/testing';
import {
  EgressStartedHandler,
  EgressStartedEvent,
} from '../egress-started.handler';
import { LiveKitService } from '../../../service/livekit.service';
import { ScenarioSessionService } from 'src/learn/service/scenario-session.service';
import { LoggerService } from 'src/logger/logger.service';
import { ParticipantJoinedHandler } from '../participant-joined.handler';

jest.mock('src/logger/logger.service');

describe('EgressStartedHandler', () => {
  let module: TestingModule;
  let handler: EgressStartedHandler;
  let liveKitService: jest.Mocked<LiveKitService>;
  let scenarioSessionService: jest.Mocked<ScenarioSessionService>;
  let mockLogger: jest.Mocked<LoggerService>;

  const mockEgressStartedEvent = (
    egressInfoPartial: Partial<
      NonNullable<EgressStartedEvent['egressInfo']>
    > = {},
  ): EgressStartedEvent => ({
    event: 'egress_started',
    egressInfo: {
      egressId: 'egress-1',
      roomName: 'test-room',
      startedAt: 1700000000000000000n,
      ...egressInfoPartial,
    },
  });

  beforeEach(async () => {
    jest.useFakeTimers();

    const mockLiveKitService = {
      getRoomById: jest.fn().mockResolvedValue({
        metadata: '{"scenarioId": 1}',
      }),
      listParticipants: jest.fn().mockResolvedValue([]),
      agentDispatch: jest.fn().mockResolvedValue(undefined),
    };

    const mockScenarioSessionService = {
      getScenarioSessionByRoomId: jest.fn(),
      updateScenarioSession: jest.fn().mockResolvedValue(undefined),
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    } as any;

    (
      LoggerService as jest.MockedClass<typeof LoggerService>
    ).mockImplementation(() => mockLogger);

    module = await Test.createTestingModule({
      providers: [
        EgressStartedHandler,
        { provide: LiveKitService, useValue: mockLiveKitService },
        {
          provide: ScenarioSessionService,
          useValue: mockScenarioSessionService,
        },
      ],
    }).compile();

    handler = module.get(EgressStartedHandler);
    liveKitService = module.get(LiveKitService);
    scenarioSessionService = module.get(ScenarioSessionService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    (ParticipantJoinedHandler as any)['dispatchesInProgress'].clear();
    (ParticipantJoinedHandler as any)[
      'activeScenarioSessionRecordings'
    ].clear();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    await module?.close();
  });

  describe('handle', () => {
    it('should warn and return when room name is missing', async () => {
      const event = mockEgressStartedEvent({ roomName: undefined });

      await handler.handle(event);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'egress_started webhook missing room_name, skipping agent dispatch',
      );
      expect(liveKitService.getRoomById).not.toHaveBeenCalled();
    });

    it('should load room and session, set startedAt when absent, and dispatch agent', async () => {
      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue({
        id: 'session-1',
        startedAt: null,
        tenantId: 'tenant-1',
      } as any);

      const event = mockEgressStartedEvent();

      await handler.handle(event);

      expect(liveKitService.getRoomById).toHaveBeenCalledWith('test-room');
      expect(
        scenarioSessionService.getScenarioSessionByRoomId,
      ).toHaveBeenCalledWith('test-room');
      expect(scenarioSessionService.updateScenarioSession).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ startedAt: expect.any(Date) }),
      );
      expect(liveKitService.agentDispatch).toHaveBeenCalledWith(
        'test-room',
        'Agent',
        expect.stringContaining('"conversationStartedAt"'),
      );
    });
  });
});
