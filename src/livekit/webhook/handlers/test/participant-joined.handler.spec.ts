import { Test, TestingModule } from '@nestjs/testing';
import { ParticipantInfo_Kind } from '@livekit/protocol';
import {
  ParticipantJoinedHandler,
  ParticipantJoinedEvent,
} from '../participant-joined.handler';
import { LiveKitService } from '../../../service/livekit.service';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioSessionService } from 'src/learn/service/scenario-session.service';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { AppConfigService } from 'src/config/config.service';

jest.mock('src/logger/logger.service');

jest.mock('src/common/util/audio.util', () => ({
  generateAudioStorageKey: jest
    .fn()
    .mockReturnValue('recordings/2025/01/01/test-room.ogg'),
}));

describe('ParticipantJoinedHandler', () => {
  let module: TestingModule;
  let handler: ParticipantJoinedHandler;
  let liveKitService: jest.Mocked<LiveKitService>;
  let scenarioSessionService: jest.Mocked<ScenarioSessionService>;
  let scenarioSharedService: jest.Mocked<ScenarioSharedService>;
  let mockLogger: jest.Mocked<LoggerService>;
  let mockAppConfigService: {
    scenarioSessionAudioStorage: {
      bucket: string;
      region: string;
      accessKey: string;
      secret: string;
    };
    featureFlag: { scenarioSessionAudioRecording: boolean };
  };

  const mockParticipantJoinedEvent: ParticipantJoinedEvent = {
    event: 'participant_joined',
    room: {
      name: 'test-room',
      sid: 'room-sid-123',
      creation_time: Date.now(),
      empty_timeout: 3600,
      max_participants: 5,
      num_participants: 1,
      num_publishers: 1,
      activeRecording: false,
      metadata: '{"scenarioId": 123, "type": "training"}',
    },
    participant: {
      sid: 'participant-sid-123',
      identity: 'user-123',
      name: 'John Doe',
      metadata: '{"role": "counselor"}',
      joined_at: Date.now(),
      version: 1,
      kind: 1,
      permission: {
        can_subscribe: true,
        can_publish: true,
        can_publish_data: true,
        hidden: false,
        recorder: false,
      },
    },
    id: 'event-id-123',
    created_at: Date.now(),
  };

  const mockAudioStorageConfig = {
    bucket: 'test-bucket',
    region: 'us-east-1',
    accessKey: 'test-access-key',
    secret: 'test-secret',
  };

  beforeEach(async () => {
    jest.useFakeTimers();

    const mockLiveKitService = {
      agentDispatch: jest.fn(),
      listParticipants: jest.fn().mockResolvedValue([]),
      startRoomCompositeEgress: jest
        .fn()
        .mockResolvedValue({ egressId: 'egress-1' }),
    };

    const mockScenarioSessionService = {
      getScenarioSessionByRoomId: jest.fn(),
      updateScenarioSession: jest.fn(),
    };

    const mockScenarioSharedService = {
      saveScenarioSessionRecording: jest
        .fn()
        .mockResolvedValue({ id: 'rec-1' }),
    };

    mockAppConfigService = {
      scenarioSessionAudioStorage: mockAudioStorageConfig,
      featureFlag: {
        scenarioSessionAudioRecording: false,
      },
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
        ParticipantJoinedHandler,
        {
          provide: LiveKitService,
          useValue: mockLiveKitService,
        },
        {
          provide: ScenarioSessionService,
          useValue: mockScenarioSessionService,
        },
        {
          provide: ScenarioSharedService,
          useValue: mockScenarioSharedService,
        },
        {
          provide: AppConfigService,
          useValue: mockAppConfigService,
        },
      ],
    }).compile();

    handler = module.get<ParticipantJoinedHandler>(ParticipantJoinedHandler);
    liveKitService = module.get(LiveKitService);
    scenarioSessionService = module.get(ScenarioSessionService);
    scenarioSharedService = module.get(ScenarioSharedService);
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
    it('should update session startedAt and dispatch agent when human joins and audio recording is disabled', async () => {
      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue({
        id: 'session-123',
        tenantId: 'tenant-1',
        startedAt: null,
      } as any);

      await handler.handle(mockParticipantJoinedEvent);

      expect(mockLogger.info).toHaveBeenCalledWith(
        `Processing participant_joined event ${JSON.stringify(mockParticipantJoinedEvent)} for ${mockParticipantJoinedEvent.participant.identity} in room ${mockParticipantJoinedEvent.room.name}`,
      );
      expect(
        scenarioSessionService.getScenarioSessionByRoomId,
      ).toHaveBeenCalledWith('test-room');
      expect(scenarioSessionService.updateScenarioSession).toHaveBeenCalledWith(
        'session-123',
        expect.objectContaining({ startedAt: expect.any(Date) }),
      );
      const expectedMetadata = JSON.stringify(
        JSON.parse(mockParticipantJoinedEvent.room.metadata),
      );
      expect(liveKitService.agentDispatch).toHaveBeenCalledWith(
        'test-room',
        'Agent',
        expectedMetadata,
      );
    });

    it('should clear in-progress dispatch when the Agent participant joins', async () => {
      ParticipantJoinedHandler.markAgentDispatchInProgress('test-room');

      const agentEvent: ParticipantJoinedEvent = {
        ...mockParticipantJoinedEvent,
        participant: {
          ...mockParticipantJoinedEvent.participant,
          kind: ParticipantInfo_Kind.AGENT,
        },
      };

      await handler.handle(agentEvent);

      expect(
        scenarioSessionService.getScenarioSessionByRoomId,
      ).not.toHaveBeenCalled();
      expect(
        ParticipantJoinedHandler.isAgentDispatchInProgress('test-room'),
      ).toBe(false);
    });

    it('should start audio recording and create recording entry when human joins and room is not recording', async () => {
      const humanEvent: ParticipantJoinedEvent = {
        ...mockParticipantJoinedEvent,
        participant: {
          ...mockParticipantJoinedEvent.participant,
          kind: ParticipantInfo_Kind.STANDARD,
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue({
        id: 'session-123',
        tenantId: 'tenant-1',
        startedAt: null,
      } as any);

      mockAppConfigService.featureFlag.scenarioSessionAudioRecording = true;

      await handler.handle(humanEvent);

      expect(liveKitService.startRoomCompositeEgress).toHaveBeenCalledWith(
        expect.objectContaining({
          roomName: 'test-room',
          bucket: mockAudioStorageConfig.bucket,
          region: mockAudioStorageConfig.region,
          accessKey: mockAudioStorageConfig.accessKey,
          secret: mockAudioStorageConfig.secret,
        }),
      );
      expect(
        scenarioSharedService.saveScenarioSessionRecording,
      ).toHaveBeenCalledWith({
        scenarioSessionId: 'session-123',
        storageKey: 'recordings/2025/01/01/test-room.ogg',
        tenantId: 'tenant-1',
        egressId: 'egress-1',
      });
      expect(liveKitService.agentDispatch).not.toHaveBeenCalled();
    });

    it('should not start egress when scenario session recording is already in progress', async () => {
      const humanEvent: ParticipantJoinedEvent = {
        ...mockParticipantJoinedEvent,
        participant: {
          ...mockParticipantJoinedEvent.participant,
          kind: ParticipantInfo_Kind.STANDARD,
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue({
        id: 'session-123',
        tenantId: 'tenant-1',
      } as any);

      mockAppConfigService.featureFlag.scenarioSessionAudioRecording = true;
      ParticipantJoinedHandler.markScenarioSessionRecordingInProgress(
        'session-123',
      );

      await handler.handle(humanEvent);

      expect(liveKitService.startRoomCompositeEgress).not.toHaveBeenCalled();
      expect(
        scenarioSharedService.saveScenarioSessionRecording,
      ).not.toHaveBeenCalled();
    });

    it('should log and return when audio storage is not configured', async () => {
      const humanEvent: ParticipantJoinedEvent = {
        ...mockParticipantJoinedEvent,
        participant: {
          ...mockParticipantJoinedEvent.participant,
          kind: ParticipantInfo_Kind.STANDARD,
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue({
        id: 'session-123',
      } as any);

      mockAppConfigService.featureFlag.scenarioSessionAudioRecording = true;
      mockAppConfigService.scenarioSessionAudioStorage = {
        bucket: '',
        region: '',
        accessKey: '',
        secret: '',
      };

      await handler.handle(humanEvent);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Scenario session audio storage configuration is missing',
      );
      expect(liveKitService.startRoomCompositeEgress).not.toHaveBeenCalled();
    });

    it('should log egress errors without throwing', async () => {
      const humanEvent: ParticipantJoinedEvent = {
        ...mockParticipantJoinedEvent,
        participant: {
          ...mockParticipantJoinedEvent.participant,
          kind: ParticipantInfo_Kind.STANDARD,
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue({
        id: 'session-123',
        tenantId: 'tenant-1',
      } as any);

      mockAppConfigService.featureFlag.scenarioSessionAudioRecording = true;
      liveKitService.startRoomCompositeEgress.mockRejectedValue(
        new Error('egress failed'),
      );

      await expect(handler.handle(humanEvent)).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to start audio recording for room test-room: egress failed',
      );
    });
  });
});
