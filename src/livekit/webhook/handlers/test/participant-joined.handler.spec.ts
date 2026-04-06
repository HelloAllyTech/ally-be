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

// Mock LoggerService
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
      active_recording: false,
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
    // Clear the static dispatch lock between tests to prevent state leakage
    (ParticipantJoinedHandler as any)['dispatchesInProgress'].clear();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    await module?.close();
  });

  describe('handle', () => {
    it('should handle participant joined event with metadata successfully', async () => {
      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue({
        id: 'session-123',
        startedAt: null,
      } as any);
      scenarioSessionService.updateScenarioSession.mockResolvedValue({} as any);
      liveKitService.agentDispatch.mockResolvedValue(undefined);

      await handler.handle(mockParticipantJoinedEvent);

      expect(mockLogger.info).toHaveBeenCalledWith(
        `Processing participant_joined event ${JSON.stringify(mockParticipantJoinedEvent)} for ${mockParticipantJoinedEvent.participant.identity} in room ${mockParticipantJoinedEvent.room.name}`,
      );
      const parsedMetadataLog = mockLogger.info.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          (call[0] as string).startsWith('Parsed metadata: '),
      );
      expect(parsedMetadataLog).toBeDefined();
      const logged = JSON.parse(
        (parsedMetadataLog![0] as string).replace(/^Parsed metadata: /, ''),
      );
      expect(logged).toMatchObject({
        scenarioId: 123,
        type: 'training',
        scenarioSession: { conversationStartedAt: expect.any(String) },
      });
      expect(liveKitService.agentDispatch).toHaveBeenCalledWith(
        'test-room',
        'Agent',
        expect.any(String),
      );
      expect(
        JSON.parse(liveKitService.agentDispatch.mock.calls[0][2] as string),
      ).toMatchObject({
        scenarioId: 123,
        type: 'training',
        scenarioSession: { conversationStartedAt: expect.any(String) },
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Successfully dispatched agent for participant Agent in room test-room',
      );
    });

    it('should skip human dispatch flow when joined participant is Agent', async () => {
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
        scenarioSessionService.updateScenarioSession,
      ).not.toHaveBeenCalled();
      expect(liveKitService.listParticipants).not.toHaveBeenCalled();
      expect(liveKitService.agentDispatch).not.toHaveBeenCalled();
    });

    it('should update scenario session startedAt when non-Agent joins and startedAt is null', async () => {
      const humanEvent: ParticipantJoinedEvent = {
        ...mockParticipantJoinedEvent,
        participant: {
          ...mockParticipantJoinedEvent.participant,
          kind: ParticipantInfo_Kind.STANDARD,
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue({
        id: 'session-123',
        startedAt: null,
      } as any);
      scenarioSessionService.updateScenarioSession.mockResolvedValue({} as any);
      liveKitService.agentDispatch.mockResolvedValue(undefined);

      await handler.handle(humanEvent);

      expect(scenarioSessionService.updateScenarioSession).toHaveBeenCalledWith(
        'session-123',
        expect.objectContaining({
          startedAt: expect.any(Date),
        }),
      );
    });

    it('should handle participant joined event with empty metadata', async () => {
      const eventWithEmptyMetadata: ParticipantJoinedEvent = {
        ...mockParticipantJoinedEvent,
        room: {
          ...mockParticipantJoinedEvent.room,
          metadata: '',
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue({
        id: 'session-123',
        startedAt: null,
      } as any);
      scenarioSessionService.updateScenarioSession.mockResolvedValue({} as any);
      liveKitService.agentDispatch.mockResolvedValue(undefined);

      await handler.handle(eventWithEmptyMetadata);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Room metadata is empty or null, using default values',
      );
      expect(liveKitService.agentDispatch).toHaveBeenCalledWith(
        'test-room',
        'Agent',
        expect.any(String),
      );
      expect(
        JSON.parse(liveKitService.agentDispatch.mock.calls[0][2] as string),
      ).toMatchObject({
        scenarioSession: { conversationStartedAt: expect.any(String) },
      });
    });

    it('should handle participant joined event with null metadata', async () => {
      const eventWithNullMetadata: ParticipantJoinedEvent = {
        ...mockParticipantJoinedEvent,
        room: {
          ...mockParticipantJoinedEvent.room,
          metadata: null as any,
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue({
        id: 'session-123',
        startedAt: null,
      } as any);
      scenarioSessionService.updateScenarioSession.mockResolvedValue({} as any);
      liveKitService.agentDispatch.mockResolvedValue(undefined);

      await handler.handle(eventWithNullMetadata);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Room metadata is empty or null, using default values',
      );
      expect(liveKitService.agentDispatch).toHaveBeenCalledWith(
        'test-room',
        'Agent',
        expect.any(String),
      );
      expect(
        JSON.parse(liveKitService.agentDispatch.mock.calls[0][2] as string),
      ).toMatchObject({
        scenarioSession: { conversationStartedAt: expect.any(String) },
      });
    });

    it('should handle participant joined event with whitespace-only metadata', async () => {
      const eventWithWhitespaceMetadata: ParticipantJoinedEvent = {
        ...mockParticipantJoinedEvent,
        room: {
          ...mockParticipantJoinedEvent.room,
          metadata: '   ',
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue({
        id: 'session-123',
        startedAt: null,
      } as any);
      scenarioSessionService.updateScenarioSession.mockResolvedValue({} as any);
      liveKitService.agentDispatch.mockResolvedValue(undefined);

      await handler.handle(eventWithWhitespaceMetadata);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Room metadata is empty or null, using default values',
      );
      expect(liveKitService.agentDispatch).toHaveBeenCalledWith(
        'test-room',
        'Agent',
        expect.any(String),
      );
      expect(
        JSON.parse(liveKitService.agentDispatch.mock.calls[0][2] as string),
      ).toMatchObject({
        scenarioSession: { conversationStartedAt: expect.any(String) },
      });
    });

    it('should handle participant joined event with invalid JSON metadata', async () => {
      const eventWithInvalidMetadata: ParticipantJoinedEvent = {
        ...mockParticipantJoinedEvent,
        room: {
          ...mockParticipantJoinedEvent.room,
          metadata: '{invalid json}',
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue({
        id: 'session-123',
        startedAt: null,
      } as any);
      scenarioSessionService.updateScenarioSession.mockResolvedValue({} as any);

      await expect(handler.handle(eventWithInvalidMetadata)).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error handling participant_joined event:'),
        expect.any(String),
      );
    });

    it('should handle agent dispatch error', async () => {
      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue({
        id: 'session-123',
        startedAt: null,
      } as any);
      scenarioSessionService.updateScenarioSession.mockResolvedValue({} as any);
      const error = new Error('Agent dispatch failed');
      liveKitService.agentDispatch.mockRejectedValue(error);

      await expect(handler.handle(mockParticipantJoinedEvent)).rejects.toThrow(
        'Agent dispatch failed',
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Error handling participant_joined event: ${error.message}`,
        error.stack,
      );
    });

    it('should handle complex metadata successfully', async () => {
      const complexMetadata = {
        scenarioId: 456,
        type: 'assessment',
        level: 'advanced',
        settings: {
          aiEnabled: true,
          recordingEnabled: false,
        },
        tags: ['training', 'counseling'],
      };

      const eventWithComplexMetadata: ParticipantJoinedEvent = {
        ...mockParticipantJoinedEvent,
        room: {
          ...mockParticipantJoinedEvent.room,
          metadata: JSON.stringify(complexMetadata),
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue({
        id: 'session-123',
        startedAt: null,
      } as any);
      scenarioSessionService.updateScenarioSession.mockResolvedValue({} as any);
      liveKitService.agentDispatch.mockResolvedValue(undefined);

      await handler.handle(eventWithComplexMetadata);

      const parsedMetadataLog = mockLogger.info.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          (call[0] as string).startsWith('Parsed metadata: '),
      );
      expect(parsedMetadataLog).toBeDefined();
      const logged = JSON.parse(
        (parsedMetadataLog![0] as string).replace(/^Parsed metadata: /, ''),
      );
      expect(logged).toMatchObject({
        ...complexMetadata,
        scenarioSession: { conversationStartedAt: expect.any(String) },
      });
      expect(liveKitService.agentDispatch).toHaveBeenCalledWith(
        'test-room',
        'Agent',
        expect.any(String),
      );
      expect(
        JSON.parse(liveKitService.agentDispatch.mock.calls[0][2] as string),
      ).toMatchObject({
        ...complexMetadata,
        scenarioSession: { conversationStartedAt: expect.any(String) },
      });
    });

    it('should handle different room names', async () => {
      const eventWithDifferentRoom: ParticipantJoinedEvent = {
        ...mockParticipantJoinedEvent,
        room: {
          ...mockParticipantJoinedEvent.room,
          name: 'scenario-room-456',
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue({
        id: 'session-123',
        startedAt: null,
      } as any);
      scenarioSessionService.updateScenarioSession.mockResolvedValue({} as any);
      liveKitService.agentDispatch.mockResolvedValue(undefined);

      await handler.handle(eventWithDifferentRoom);

      expect(liveKitService.agentDispatch).toHaveBeenCalledWith(
        'scenario-room-456',
        'Agent',
        expect.any(String),
      );
      expect(
        JSON.parse(liveKitService.agentDispatch.mock.calls[0][2] as string),
      ).toMatchObject({
        scenarioId: 123,
        type: 'training',
        scenarioSession: { conversationStartedAt: expect.any(String) },
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Successfully dispatched agent for participant Agent in room scenario-room-456',
      );
    });

    it('should handle different participant identities', async () => {
      const eventWithDifferentParticipant: ParticipantJoinedEvent = {
        ...mockParticipantJoinedEvent,
        participant: {
          ...mockParticipantJoinedEvent.participant,
          identity: 'counselor-789',
          name: 'Jane Smith',
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue({
        id: 'session-123',
        startedAt: null,
      } as any);
      scenarioSessionService.updateScenarioSession.mockResolvedValue({} as any);
      liveKitService.agentDispatch.mockResolvedValue(undefined);

      await handler.handle(eventWithDifferentParticipant);

      expect(mockLogger.info).toHaveBeenCalledWith(
        `Processing participant_joined event ${JSON.stringify(eventWithDifferentParticipant)} for counselor-789 in room test-room`,
      );
      expect(liveKitService.agentDispatch).toHaveBeenCalledWith(
        'test-room',
        'Agent',
        expect.any(String),
      );
      expect(
        JSON.parse(liveKitService.agentDispatch.mock.calls[0][2] as string),
      ).toMatchObject({
        scenarioId: 123,
        type: 'training',
        scenarioSession: { conversationStartedAt: expect.any(String) },
      });
    });

    it('should handle minimal event data', async () => {
      const minimalEvent: ParticipantJoinedEvent = {
        event: 'participant_joined',
        room: {
          name: 'minimal-room',
          sid: 'room-sid-minimal',
          creation_time: Date.now(),
          empty_timeout: 3600,
          max_participants: 2,
          num_participants: 1,
          num_publishers: 0,
          active_recording: false,
          metadata: '',
        },
        participant: {
          sid: 'participant-minimal',
          identity: 'minimal-user',
          name: 'Minimal User',
          metadata: '',
          joined_at: Date.now(),
          version: 1,
          kind: 1,
          permission: {
            can_subscribe: true,
            can_publish: false,
            can_publish_data: false,
            hidden: false,
            recorder: false,
          },
        },
        id: 'minimal-event-id',
        created_at: Date.now(),
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue({
        id: 'session-123',
        startedAt: null,
      } as any);
      scenarioSessionService.updateScenarioSession.mockResolvedValue({} as any);
      liveKitService.agentDispatch.mockResolvedValue(undefined);

      await handler.handle(minimalEvent);

      expect(liveKitService.agentDispatch).toHaveBeenCalledWith(
        'minimal-room',
        'Agent',
        expect.any(String),
      );
      expect(
        JSON.parse(liveKitService.agentDispatch.mock.calls[0][2] as string),
      ).toMatchObject({
        scenarioSession: { conversationStartedAt: expect.any(String) },
      });
    });

    it('should handle numeric metadata values', async () => {
      const numericMetadata = {
        scenarioId: 999,
        duration: 3600,
        maxScore: 100,
        difficulty: 5.5,
      };

      const eventWithNumericMetadata: ParticipantJoinedEvent = {
        ...mockParticipantJoinedEvent,
        room: {
          ...mockParticipantJoinedEvent.room,
          metadata: JSON.stringify(numericMetadata),
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue({
        id: 'session-123',
        startedAt: null,
      } as any);
      scenarioSessionService.updateScenarioSession.mockResolvedValue({} as any);
      liveKitService.agentDispatch.mockResolvedValue(undefined);

      await handler.handle(eventWithNumericMetadata);

      expect(liveKitService.agentDispatch).toHaveBeenCalledWith(
        'test-room',
        'Agent',
        expect.any(String),
      );
      expect(
        JSON.parse(liveKitService.agentDispatch.mock.calls[0][2] as string),
      ).toMatchObject({
        ...numericMetadata,
        scenarioSession: { conversationStartedAt: expect.any(String) },
      });
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
      scenarioSessionService.updateScenarioSession.mockResolvedValue({} as any);
      liveKitService.agentDispatch.mockResolvedValue(undefined);

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
    });

    it('should skip agent dispatch if an agent is already present in the room', async () => {
      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue({
        id: 'session-123',
        startedAt: null,
      } as any);

      // Mock listParticipants to return an existing agent
      liveKitService.listParticipants.mockResolvedValue([
        { identity: 'Agent', kind: ParticipantInfo_Kind.AGENT },
        { identity: 'existing-user', kind: ParticipantInfo_Kind.STANDARD },
      ] as any);

      await handler.handle(mockParticipantJoinedEvent);

      expect(liveKitService.listParticipants).toHaveBeenCalledWith('test-room');
      expect(liveKitService.agentDispatch).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        `Agent already present in room test-room, skipping dispatch`,
      );
    });

    it('should proceed with agent dispatch if no agent is present in the room', async () => {
      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue({
        id: 'session-123',
        startedAt: null,
      } as any);

      // Mock listParticipants to return only human participants
      liveKitService.listParticipants.mockResolvedValue([
        { identity: 'other-user', kind: ParticipantInfo_Kind.STANDARD },
      ] as any);

      liveKitService.agentDispatch.mockResolvedValue(undefined);

      await handler.handle(mockParticipantJoinedEvent);

      expect(liveKitService.listParticipants).toHaveBeenCalledWith('test-room');
      expect(liveKitService.agentDispatch).toHaveBeenCalled();
    });
  });
});
