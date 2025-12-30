import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { LiveKitController } from '../livekit.controller';
import { LiveKitService } from '../../service/livekit.service';
import { CreateRoomDto } from '../../dto/create-room.dto';
import { JoinRoomDto } from '../../dto/join-room.dto';
import { PermissionsService } from '../../../authorization/service/permissions.service';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { UserService } from '../../../user/service/user.service';
import { AppConfigService } from '../../../config/config.service';

describe('LiveKitController', () => {
  let controller: LiveKitController;
  let liveKitService: jest.Mocked<LiveKitService>;

  const mockRoom = {
    name: 'test-room',
    sid: 'room-sid-123',
    creation_time: Date.now(),
    empty_timeout: 3600,
    max_participants: 5,
    num_participants: 0,
    num_publishers: 0,
    active_recording: false,
    metadata: '',
  };

  const mockTokenResponse = {
    token: 'mock-jwt-token',
    roomName: 'test-room',
    serverUrl: 'https://livekit.example.com',
  };

  const mockParticipants = [
    {
      sid: 'participant-sid-1',
      identity: 'user-123',
      name: 'John Doe',
      joined_at: Date.now(),
    },
    {
      sid: 'participant-sid-2',
      identity: 'user-456',
      name: 'Jane Doe',
      joined_at: Date.now(),
    },
  ];

  beforeEach(async () => {
    const mockLiveKitService = {
      generateAccessToken: jest.fn(),
      createRoom: jest.fn(),
      listRooms: jest.fn(),
      deleteRoom: jest.fn(),
      listParticipants: jest.fn(),
      removeParticipant: jest.fn(),
      agentDispatch: jest.fn(),
    };

    const mockPermissionsService = {
      getUserRoles: jest.fn().mockResolvedValue(['SUPER_ADMIN']),
      getUserPermissions: jest.fn().mockResolvedValue(['edit:livekit']),
    };

    const mockUserService = {
      getTermsAndAgreementApproval: jest.fn().mockResolvedValue(true),
    };

    const mockReflector = {
      get: jest.fn(),
      getAll: jest.fn(),
      getAllAndOverride: jest.fn().mockReturnValue({
        permissions: ['edit:livekit'],
        operator: 'AND',
      }),
      getAllAndMerge: jest.fn(),
    };

    const mockRolesGuard = {
      canActivate: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LiveKitController],
      providers: [
        {
          provide: LiveKitService,
          useValue: mockLiveKitService,
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
        {
          provide: UserService,
          useValue: mockUserService,
        },
        {
          provide: AppConfigService,
          useValue: {
            featureFlag: {
              termsAndAgreement: false,
            },
          },
        },
        {
          provide: Reflector,
          useValue: mockReflector,
        },
        {
          provide: RolesGuard,
          useValue: mockRolesGuard,
        },
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue(mockRolesGuard)
      .compile();

    controller = module.get<LiveKitController>(LiveKitController);
    liveKitService = module.get(LiveKitService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateToken', () => {
    it('should generate access token successfully', async () => {
      const joinRoomDto: JoinRoomDto = {
        roomName: 'test-room',
        participantName: 'John Doe',
        participantIdentity: 'user-123',
      };

      liveKitService.generateAccessToken.mockResolvedValue(mockTokenResponse);

      const result = await controller.generateToken(joinRoomDto);

      expect(liveKitService.generateAccessToken).toHaveBeenCalledWith(
        joinRoomDto,
      );
      expect(result).toEqual(mockTokenResponse);
    });

    it('should handle token generation error', async () => {
      const joinRoomDto: JoinRoomDto = {
        roomName: 'test-room',
        participantName: 'John Doe',
      };

      const error = new Error('Token generation failed');
      liveKitService.generateAccessToken.mockRejectedValue(error);

      await expect(controller.generateToken(joinRoomDto)).rejects.toThrow(
        'Token generation failed',
      );
    });

    it('should generate token with minimal data', async () => {
      const joinRoomDto: JoinRoomDto = {
        roomName: 'minimal-room',
        participantName: 'Minimal User',
      };

      const minimalTokenResponse = {
        token: 'minimal-jwt-token',
        roomName: 'minimal-room',
        serverUrl: 'https://livekit.example.com',
      };

      liveKitService.generateAccessToken.mockResolvedValue(
        minimalTokenResponse,
      );

      const result = await controller.generateToken(joinRoomDto);

      expect(result).toEqual(minimalTokenResponse);
    });
  });

  describe('createRoom', () => {
    it('should create room successfully', async () => {
      const createRoomDto: CreateRoomDto = {
        name: 'test-room',
        ttl: 7200,
        maxParticipants: 10,
        metadata: { userId: 123 },
      };

      liveKitService.createRoom.mockResolvedValue(mockRoom as any);

      const result = await controller.createRoom(createRoomDto);

      expect(liveKitService.createRoom).toHaveBeenCalledWith(createRoomDto);
      expect(result).toEqual(mockRoom);
    });

    it('should create room with minimal data', async () => {
      const createRoomDto: CreateRoomDto = {
        name: 'minimal-room',
      };

      const minimalRoom = {
        ...mockRoom,
        name: 'minimal-room',
      };

      liveKitService.createRoom.mockResolvedValue(minimalRoom as any);

      const result = await controller.createRoom(createRoomDto);

      expect(liveKitService.createRoom).toHaveBeenCalledWith(createRoomDto);
      expect(result).toEqual(minimalRoom);
    });

    it('should handle room creation error', async () => {
      const createRoomDto: CreateRoomDto = {
        name: 'error-room',
      };

      const error = new Error('Room creation failed');
      liveKitService.createRoom.mockRejectedValue(error);

      await expect(controller.createRoom(createRoomDto)).rejects.toThrow(
        'Room creation failed',
      );
    });

    it('should create room with all optional parameters', async () => {
      const createRoomDto: CreateRoomDto = {
        name: 'full-room',
        ttl: 14400,
        maxParticipants: 20,
        metadata: {
          scenarioId: 456,
          type: 'training',
          level: 'advanced',
        },
      };

      const fullRoom = {
        ...mockRoom,
        name: 'full-room',
        empty_timeout: 14400,
        max_participants: 20,
      };

      liveKitService.createRoom.mockResolvedValue(fullRoom as any);

      const result = await controller.createRoom(createRoomDto);

      expect(result).toEqual(fullRoom);
    });
  });

  describe('listRooms', () => {
    it('should list rooms successfully', async () => {
      const mockRooms = [
        mockRoom,
        {
          ...mockRoom,
          name: 'room-2',
          sid: 'room-sid-456',
        },
      ];

      liveKitService.listRooms.mockResolvedValue(mockRooms as any);

      const result = await controller.listRooms();

      expect(liveKitService.listRooms).toHaveBeenCalled();
      expect(result).toEqual(mockRooms);
    });

    it('should handle empty rooms list', async () => {
      liveKitService.listRooms.mockResolvedValue([]);

      const result = await controller.listRooms();

      expect(result).toEqual([]);
    });

    it('should handle list rooms error', async () => {
      const error = new Error('Failed to list rooms');
      liveKitService.listRooms.mockRejectedValue(error);

      await expect(controller.listRooms()).rejects.toThrow(
        'Failed to list rooms',
      );
    });
  });

  describe('deleteRoom', () => {
    it('should delete room successfully', async () => {
      const roomName = 'test-room';
      liveKitService.deleteRoom.mockResolvedValue(undefined);

      const result = await controller.deleteRoom(roomName);

      expect(liveKitService.deleteRoom).toHaveBeenCalledWith(roomName);
      expect(result).toEqual({ message: 'Room deleted successfully' });
    });

    it('should handle room deletion error', async () => {
      const roomName = 'error-room';
      const error = new Error('Room deletion failed');
      liveKitService.deleteRoom.mockRejectedValue(error);

      await expect(controller.deleteRoom(roomName)).rejects.toThrow(
        'Room deletion failed',
      );
    });

    it('should delete room with special characters in name', async () => {
      const roomName = 'room-with-special-chars_123-456';
      liveKitService.deleteRoom.mockResolvedValue(undefined);

      const result = await controller.deleteRoom(roomName);

      expect(liveKitService.deleteRoom).toHaveBeenCalledWith(roomName);
      expect(result).toEqual({ message: 'Room deleted successfully' });
    });
  });

  describe('listParticipants', () => {
    it('should list participants successfully', async () => {
      const roomName = 'test-room';
      liveKitService.listParticipants.mockResolvedValue(
        mockParticipants as any,
      );

      const result = await controller.listParticipants(roomName);

      expect(liveKitService.listParticipants).toHaveBeenCalledWith(roomName);
      expect(result).toEqual(mockParticipants);
    });

    it('should handle empty participants list', async () => {
      const roomName = 'empty-room';
      liveKitService.listParticipants.mockResolvedValue([]);

      const result = await controller.listParticipants(roomName);

      expect(result).toEqual([]);
    });

    it('should handle list participants error', async () => {
      const roomName = 'error-room';
      const error = new Error('Failed to list participants');
      liveKitService.listParticipants.mockRejectedValue(error);

      await expect(controller.listParticipants(roomName)).rejects.toThrow(
        'Failed to list participants',
      );
    });

    it('should list participants for room with special characters', async () => {
      const roomName = 'room_with-special.chars';
      liveKitService.listParticipants.mockResolvedValue(
        mockParticipants as any,
      );

      const result = await controller.listParticipants(roomName);

      expect(liveKitService.listParticipants).toHaveBeenCalledWith(roomName);
      expect(result).toEqual(mockParticipants);
    });
  });

  describe('removeParticipant', () => {
    it('should remove participant successfully', async () => {
      const roomName = 'test-room';
      const participantIdentity = 'user-123';
      const mockResponse = { message: 'Participant removed successfully' };

      liveKitService.removeParticipant.mockResolvedValue(mockResponse);

      const result = await controller.removeParticipant(
        roomName,
        participantIdentity,
      );

      expect(liveKitService.removeParticipant).toHaveBeenCalledWith(
        roomName,
        participantIdentity,
      );
      expect(result).toEqual(mockResponse);
    });

    it('should handle remove participant error', async () => {
      const roomName = 'error-room';
      const participantIdentity = 'user-123';
      const error = new Error('Failed to remove participant');

      liveKitService.removeParticipant.mockRejectedValue(error);

      await expect(
        controller.removeParticipant(roomName, participantIdentity),
      ).rejects.toThrow('Failed to remove participant');
    });

    it('should remove participant with special characters in identity', async () => {
      const roomName = 'test-room';
      const participantIdentity = 'user_with-special.chars@123';
      const mockResponse = { message: 'Participant removed successfully' };

      liveKitService.removeParticipant.mockResolvedValue(mockResponse);

      const result = await controller.removeParticipant(
        roomName,
        participantIdentity,
      );

      expect(liveKitService.removeParticipant).toHaveBeenCalledWith(
        roomName,
        participantIdentity,
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('agentDispatch', () => {
    it('should dispatch agent successfully with default participant identity', async () => {
      const roomName = 'test-room';
      liveKitService.agentDispatch.mockResolvedValue(undefined);

      const result = await controller.agentDispatch(roomName);

      expect(liveKitService.agentDispatch).toHaveBeenCalledWith(
        roomName,
        'Agent',
      );
      expect(result).toBeUndefined();
    });

    it('should dispatch agent with custom participant identity', async () => {
      const roomName = 'test-room';
      const participantIdentity = 'CustomAgent';
      liveKitService.agentDispatch.mockResolvedValue(undefined);

      const result = await controller.agentDispatch(
        roomName,
        participantIdentity,
      );

      expect(liveKitService.agentDispatch).toHaveBeenCalledWith(
        roomName,
        participantIdentity,
      );
      expect(result).toBeUndefined();
    });

    it('should handle agent dispatch error', async () => {
      const roomName = 'error-room';
      const error = new Error('Failed to dispatch agent');
      liveKitService.agentDispatch.mockRejectedValue(error);

      await expect(controller.agentDispatch(roomName)).rejects.toThrow(
        'Failed to dispatch agent',
      );
    });

    it('should dispatch agent to room with special characters', async () => {
      const roomName = 'room_with-special.chars';
      const participantIdentity = 'SpecialAgent_123';
      liveKitService.agentDispatch.mockResolvedValue(undefined);

      const result = await controller.agentDispatch(
        roomName,
        participantIdentity,
      );

      expect(liveKitService.agentDispatch).toHaveBeenCalledWith(
        roomName,
        participantIdentity,
      );
      expect(result).toBeUndefined();
    });
  });
});
