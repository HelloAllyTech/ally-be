import { Test, TestingModule } from '@nestjs/testing';
import { LiveKitService } from '../livekit.service';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  AccessToken,
  AgentDispatchClient,
  EgressClient,
  RoomServiceClient,
} from 'livekit-server-sdk';
import { CreateRoomDto } from '../../dto/create-room.dto';
import { JoinRoomDto } from '../../dto/join-room.dto';
import {
  DEFAULT_ROOM_TTL,
  MAX_PARTICIPANTS,
} from '../../constants/livekit.constants';

// Mock livekit-server-sdk
jest.mock('livekit-server-sdk', () => ({
  RoomServiceClient: jest.fn().mockImplementation(() => ({
    createRoom: jest.fn(),
    deleteRoom: jest.fn(),
    listRooms: jest.fn(),
    listParticipants: jest.fn(),
    removeParticipant: jest.fn(),
  })),
  AgentDispatchClient: jest.fn().mockImplementation(() => ({
    createDispatch: jest.fn(),
    listDispatch: jest.fn(),
  })),
  EgressClient: jest.fn().mockImplementation(() => ({
    startRoomCompositeEgress: jest.fn(),
    stopEgress: jest.fn(),
  })),
  AccessToken: jest.fn().mockImplementation(() => ({
    addGrant: jest.fn(),
    toJwt: jest.fn(),
  })),
}));

jest.mock('@livekit/protocol', () => ({
  EncodedFileOutput: jest.fn().mockImplementation((data) => data),
  EncodedFileType: { OGG: 3 },
  S3Upload: jest.fn().mockImplementation((data) => data),
}));

// Mock LoggerService
jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    }),
  },
}));

describe('LiveKitService', () => {
  let service: LiveKitService;
  let mockLogger: jest.Mocked<any>;
  let mockRoomService: jest.Mocked<RoomServiceClient>;
  let mockAgentService: jest.Mocked<AgentDispatchClient>;
  let mockEgressService: jest.Mocked<any>;
  let mockAccessToken: jest.Mocked<AccessToken>;

  const mockLiveKitConfig = {
    serverUrl: 'https://livekit.example.com',
    apiKey: 'test-api-key',
    apiSecret: 'test-api-secret',
  };

  beforeEach(async () => {
    const mockConfigService = {
      livekit: mockLiveKitConfig,
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    };

    mockRoomService = {
      createRoom: jest.fn(),
      deleteRoom: jest.fn(),
      listRooms: jest.fn(),
      listParticipants: jest.fn(),
      removeParticipant: jest.fn(),
    } as any;

    mockAgentService = {
      createDispatch: jest.fn(),
      listDispatch: jest.fn().mockResolvedValue([]),
    } as any;

    mockEgressService = {
      startRoomCompositeEgress: jest.fn(),
      stopEgress: jest.fn(),
    };

    mockAccessToken = {
      addGrant: jest.fn(),
      toJwt: jest.fn(),
    } as any;

    (LoggerService.getInstance as jest.Mock).mockReturnValue(mockLogger);
    (RoomServiceClient as jest.Mock).mockReturnValue(mockRoomService);
    (AgentDispatchClient as jest.Mock).mockReturnValue(mockAgentService);
    (EgressClient as jest.Mock).mockReturnValue(mockEgressService);
    (AccessToken as jest.Mock).mockReturnValue(mockAccessToken);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiveKitService,
        {
          provide: AppConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<LiveKitService>(LiveKitService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor and initialization', () => {
    it('should initialize services with valid configuration', () => {
      expect(RoomServiceClient).toHaveBeenCalledWith(
        mockLiveKitConfig.serverUrl,
        mockLiveKitConfig.apiKey,
        mockLiveKitConfig.apiSecret,
      );
      expect(AgentDispatchClient).toHaveBeenCalledWith(
        mockLiveKitConfig.serverUrl,
        mockLiveKitConfig.apiKey,
        mockLiveKitConfig.apiSecret,
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'LiveKit room service initialized',
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'LiveKit agent service initialized',
      );
    });

    it('should warn when configuration is missing', () => {
      const incompleteConfig = {
        livekit: {
          serverUrl: '',
          apiKey: '',
          apiSecret: '',
        },
      };

      const mockIncompleteConfigService = {
        livekit: incompleteConfig.livekit,
      };

      jest.clearAllMocks();

      new LiveKitService(mockIncompleteConfigService as any);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'LiveKit configuration missing. Service will not be available.',
      );
    });

    it('should warn when serverUrl is missing', () => {
      const configWithoutServerUrl = {
        livekit: {
          serverUrl: '',
          apiKey: 'test-key',
          apiSecret: 'test-secret',
        },
      };

      jest.clearAllMocks();

      new LiveKitService(configWithoutServerUrl as any);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'LiveKit configuration missing. Service will not be available.',
      );
    });

    it('should warn when apiKey is missing', () => {
      const configWithoutApiKey = {
        livekit: {
          serverUrl: 'https://test.com',
          apiKey: '',
          apiSecret: 'test-secret',
        },
      };

      jest.clearAllMocks();

      new LiveKitService(configWithoutApiKey as any);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'LiveKit configuration missing. Service will not be available.',
      );
    });

    it('should warn when apiSecret is missing', () => {
      const configWithoutApiSecret = {
        livekit: {
          serverUrl: 'https://test.com',
          apiKey: 'test-key',
          apiSecret: '',
        },
      };

      jest.clearAllMocks();

      new LiveKitService(configWithoutApiSecret as any);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'LiveKit configuration missing. Service will not be available.',
      );
    });
  });

  describe('createRoom', () => {
    it('should create room with default values', async () => {
      const createRoomDto: CreateRoomDto = {
        name: 'test-room',
      };

      const mockRoom = {
        name: 'test-room',
        sid: 'room-sid-123',
        creation_time: Date.now(),
      };

      mockRoomService.createRoom.mockResolvedValue(mockRoom as any);

      const result = await service.createRoom(createRoomDto);

      expect(mockRoomService.createRoom).toHaveBeenCalledWith({
        name: 'test-room',
        emptyTimeout: DEFAULT_ROOM_TTL,
        maxParticipants: MAX_PARTICIPANTS,
        metadata: undefined,
      });
      expect(result).toEqual(mockRoom);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Room created: ${mockRoom.name}`,
      );
    });

    it('should create room with custom values', async () => {
      const createRoomDto: CreateRoomDto = {
        name: 'custom-room',
        ttl: 7200,
        maxParticipants: 10,
        metadata: { userId: 123, type: 'scenario' },
      };

      const mockRoom = {
        name: 'custom-room',
        sid: 'room-sid-456',
        creation_time: Date.now(),
      };

      mockRoomService.createRoom.mockResolvedValue(mockRoom as any);

      const result = await service.createRoom(createRoomDto);

      expect(mockRoomService.createRoom).toHaveBeenCalledWith({
        name: 'custom-room',
        emptyTimeout: 7200,
        maxParticipants: 10,
        metadata: JSON.stringify({ userId: 123, type: 'scenario' }),
      });
      expect(result).toEqual(mockRoom);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Room created: ${mockRoom.name}`,
      );
    });

    it('should handle room creation error', async () => {
      const createRoomDto: CreateRoomDto = {
        name: 'error-room',
      };

      const error = new Error('Room creation failed');
      mockRoomService.createRoom.mockRejectedValue(error);

      await expect(service.createRoom(createRoomDto)).rejects.toThrow(
        'Room creation failed',
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to create room: "Room creation failed"',
      );
    });

    it('should handle room creation error without message', async () => {
      const createRoomDto: CreateRoomDto = {
        name: 'error-room',
      };

      const error = { code: 'UNKNOWN_ERROR' };
      mockRoomService.createRoom.mockRejectedValue(error);

      await expect(service.createRoom(createRoomDto)).rejects.toBe(error);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to create room: undefined',
      );
    });
  });

  describe('deleteRoom', () => {
    it('should delete room successfully', async () => {
      const roomName = 'test-room';
      mockRoomService.deleteRoom.mockResolvedValue(undefined);

      await service.deleteRoom(roomName);

      expect(mockRoomService.deleteRoom).toHaveBeenCalledWith(roomName);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Room deleted: ${roomName}`,
      );
    });

    it('should handle room deletion error', async () => {
      const roomName = 'error-room';
      const error = new Error('Room deletion failed');
      mockRoomService.deleteRoom.mockRejectedValue(error);

      await expect(service.deleteRoom(roomName)).rejects.toThrow(
        'Room deletion failed',
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to delete room: "Room deletion failed"',
      );
    });

    it('should handle room deletion error without message', async () => {
      const roomName = 'error-room';
      const error = { code: 'UNKNOWN_ERROR' };
      mockRoomService.deleteRoom.mockRejectedValue(error);

      await expect(service.deleteRoom(roomName)).rejects.toBe(error);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to delete room: undefined',
      );
    });
  });

  describe('generateAccessToken', () => {
    it('should generate access token successfully', async () => {
      const joinRoomDto: JoinRoomDto = {
        roomName: 'test-room',
        participantName: 'John Doe',
        participantIdentity: 'user-123',
      };

      const mockJwt = 'mock-jwt-token';
      mockAccessToken.toJwt.mockResolvedValue(mockJwt);

      const result = await service.generateAccessToken(joinRoomDto);

      expect(AccessToken).toHaveBeenCalledWith(
        mockLiveKitConfig.apiKey,
        mockLiveKitConfig.apiSecret,
        {
          identity: 'user-123',
          name: 'John Doe',
        },
      );
      expect(mockAccessToken.addGrant).toHaveBeenCalledWith({
        room: 'test-room',
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
      });
      expect(result).toEqual({
        token: mockJwt,
        roomName: 'test-room',
        serverUrl: mockLiveKitConfig.serverUrl,
      });
    });

    it('should use participantName as identity when participantIdentity is not provided', async () => {
      const joinRoomDto: JoinRoomDto = {
        roomName: 'test-room',
        participantName: 'Jane Doe',
      };

      const mockJwt = 'mock-jwt-token';
      mockAccessToken.toJwt.mockResolvedValue(mockJwt);

      const result = await service.generateAccessToken(joinRoomDto);

      expect(AccessToken).toHaveBeenCalledWith(
        mockLiveKitConfig.apiKey,
        mockLiveKitConfig.apiSecret,
        {
          identity: 'Jane Doe',
          name: 'Jane Doe',
        },
      );
      expect(result).toEqual({
        token: mockJwt,
        roomName: 'test-room',
        serverUrl: mockLiveKitConfig.serverUrl,
      });
    });

    it('should throw error when API credentials are not configured', async () => {
      const joinRoomDto: JoinRoomDto = {
        roomName: 'test-room',
        participantName: 'John Doe',
      };

      // Create a new service instance with empty credentials
      const incompleteConfig = {
        livekit: {
          serverUrl: 'https://test.com',
          apiKey: '',
          apiSecret: '',
        },
      };

      const serviceWithEmptyConfig = new LiveKitService(
        incompleteConfig as any,
      );

      await expect(
        serviceWithEmptyConfig.generateAccessToken(joinRoomDto),
      ).rejects.toThrow('LiveKit API credentials not configured');
    });

    it('should handle token generation error', async () => {
      const joinRoomDto: JoinRoomDto = {
        roomName: 'test-room',
        participantName: 'John Doe',
      };

      const error = new Error('Token generation failed');
      mockAccessToken.toJwt.mockRejectedValue(error);

      await expect(service.generateAccessToken(joinRoomDto)).rejects.toThrow(
        'Token generation failed',
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to generate access token:',
        '"Token generation failed"',
      );
    });

    it('should handle token generation error without message', async () => {
      const joinRoomDto: JoinRoomDto = {
        roomName: 'test-room',
        participantName: 'John Doe',
      };

      const error = { code: 'UNKNOWN_ERROR' };
      mockAccessToken.toJwt.mockRejectedValue(error);

      await expect(service.generateAccessToken(joinRoomDto)).rejects.toBe(
        error,
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to generate access token:',
        undefined,
      );
    });
  });

  describe('listRooms', () => {
    it('should list rooms successfully', async () => {
      const mockRooms = [
        { name: 'room1', sid: 'sid1' },
        { name: 'room2', sid: 'sid2' },
      ];

      mockRoomService.listRooms.mockResolvedValue(mockRooms as any);

      const result = await service.listRooms();

      expect(mockRoomService.listRooms).toHaveBeenCalled();
      expect(result).toEqual(mockRooms);
    });

    it('should handle list rooms error', async () => {
      const error = new Error('Failed to list rooms');
      mockRoomService.listRooms.mockRejectedValue(error);

      await expect(service.listRooms()).rejects.toThrow('Failed to list rooms');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to list rooms: Failed to list rooms',
      );
    });
  });

  describe('listParticipants', () => {
    it('should list participants successfully', async () => {
      const roomName = 'test-room';
      const mockParticipants = [
        { identity: 'user1', name: 'User 1' },
        { identity: 'user2', name: 'User 2' },
      ];

      mockRoomService.listParticipants.mockResolvedValue(
        mockParticipants as any,
      );

      const result = await service.listParticipants(roomName);

      expect(mockRoomService.listParticipants).toHaveBeenCalledWith(roomName);
      expect(result).toEqual(mockParticipants);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Listed participants for room: ${roomName}`,
      );
    });

    it('should handle list participants error', async () => {
      const roomName = 'error-room';
      const error = new Error('Failed to list participants');
      mockRoomService.listParticipants.mockRejectedValue(error);

      await expect(service.listParticipants(roomName)).rejects.toThrow(
        'Failed to list participants',
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to list participants for room ${roomName}: Failed to list participants`,
      );
    });
  });

  describe('removeParticipant', () => {
    it('should remove participant successfully', async () => {
      const roomName = 'test-room';
      const participantIdentity = 'user-123';

      mockRoomService.removeParticipant.mockResolvedValue(undefined);

      const result = await service.removeParticipant(
        roomName,
        participantIdentity,
      );

      expect(mockRoomService.removeParticipant).toHaveBeenCalledWith(
        roomName,
        participantIdentity,
      );
      expect(result).toEqual({ message: 'Participant removed successfully' });
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Removed participant ${participantIdentity} from room: ${roomName}`,
      );
    });

    it('should handle remove participant error', async () => {
      const roomName = 'error-room';
      const participantIdentity = 'user-123';
      const error = new Error('Failed to remove participant');

      mockRoomService.removeParticipant.mockRejectedValue(error);

      await expect(
        service.removeParticipant(roomName, participantIdentity),
      ).rejects.toThrow('Failed to remove participant');

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to remove participant ${participantIdentity} from room ${roomName}: Failed to remove participant`,
      );
    });
  });

  describe('agentDispatch', () => {
    it('should dispatch agent successfully', async () => {
      const roomName = 'test-room';
      const participantIdentity = 'Agent';
      const metadata = '{"type":"scenario"}';

      mockAgentService.createDispatch.mockResolvedValue({} as any);

      await service.agentDispatch(roomName, participantIdentity, metadata);

      expect(mockAgentService.createDispatch).toHaveBeenCalledWith(
        roomName,
        participantIdentity,
        { metadata },
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Agent dispatched to room: ${roomName}`,
      );
    });

    it('should dispatch agent without metadata', async () => {
      const roomName = 'test-room';
      const participantIdentity = 'Agent';

      mockAgentService.createDispatch.mockResolvedValue({} as any);

      await service.agentDispatch(roomName, participantIdentity);

      expect(mockAgentService.createDispatch).toHaveBeenCalledWith(
        roomName,
        participantIdentity,
        { metadata: undefined },
      );
    });

    it('should handle agent dispatch error', async () => {
      const roomName = 'error-room';
      const participantIdentity = 'Agent';
      const error = new Error('Failed to dispatch agent');

      mockAgentService.createDispatch.mockRejectedValue(error);

      await expect(
        service.agentDispatch(roomName, participantIdentity),
      ).rejects.toThrow('Failed to dispatch agent');

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to dispatch agent to room ${roomName}: Failed to dispatch agent`,
      );
    });

    it('should skip createDispatch if an existing dispatch matches the agent name', async () => {
      const roomName = 'duplicate-room';
      const participantIdentity = 'Agent';
      (mockAgentService.listDispatch as jest.Mock).mockResolvedValue([
        { agentName: participantIdentity } as any,
      ]);

      await service.agentDispatch(roomName, participantIdentity);

      expect(mockAgentService.listDispatch).toHaveBeenCalledWith(roomName);
      expect(mockAgentService.createDispatch).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Agent ${participantIdentity} already dispatched to room ${roomName}, skipping`,
      );
    });

    it('should still dispatch if existing dispatches are for a different agent name', async () => {
      const roomName = 'other-agent-room';
      const participantIdentity = 'Agent';
      (mockAgentService.listDispatch as jest.Mock).mockResolvedValue([
        { agentName: 'SomeOtherAgent' } as any,
      ]);
      mockAgentService.createDispatch.mockResolvedValue({} as any);

      await service.agentDispatch(roomName, participantIdentity);

      expect(mockAgentService.createDispatch).toHaveBeenCalledWith(
        roomName,
        participantIdentity,
        { metadata: undefined },
      );
    });
  });

  describe('initializeEgressService', () => {
    it('should initialize egress service with valid configuration', () => {
      expect(EgressClient).toHaveBeenCalledWith(
        mockLiveKitConfig.serverUrl,
        mockLiveKitConfig.apiKey,
        mockLiveKitConfig.apiSecret,
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'LiveKit egress service initialized',
      );
    });
  });

  describe('startRoomCompositeEgress', () => {
    it('should start room composite egress successfully', async () => {
      const mockEgressInfo = { egressId: 'egress-123' };
      mockEgressService.startRoomCompositeEgress.mockResolvedValue(
        mockEgressInfo,
      );

      const result = await service.startRoomCompositeEgress({
        roomName: 'test-room',
        filepath: 'recordings/2025/01/01/test-room.ogg',
        bucket: 'test-bucket',
        region: 'us-east-1',
        accessKey: 'access-key',
        secret: 'secret-key',
      });

      expect(result).toEqual(mockEgressInfo);
      expect(mockEgressService.startRoomCompositeEgress).toHaveBeenCalledWith(
        'test-room',
        expect.any(Object),
        { audioOnly: true },
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Room composite egress started: egress-123 for room test-room',
      );
    });
  });

  describe('stopEgress', () => {
    it('should stop egress successfully', async () => {
      const mockEgressInfo = { egressId: 'egress-123' };
      mockEgressService.stopEgress.mockResolvedValue(mockEgressInfo);

      const result = await service.stopEgress('egress-123');

      expect(result).toEqual(mockEgressInfo);
      expect(mockEgressService.stopEgress).toHaveBeenCalledWith('egress-123');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Egress stopped: egress-123',
      );
    });
  });
});
