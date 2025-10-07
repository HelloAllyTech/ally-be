import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { DataSource, Repository, In } from 'typeorm';
import { ScenarioSessionService } from '../scenario-session.service';
import { ScenarioSessionRepository } from '../../repository/scenario-session.repository';
import { ScenarioSessionMessagesRepository } from '../../repository/scenario-session-messages.repository';
import { ScenarioService } from '../scenario.service';
import { LiveKitService } from 'src/livekit/service/livekit.service';
import { SessionEventService } from 'src/session-event/service/session-event.service';
import { SessionEvents } from 'src/session-event/entity/session-events.entity';
import { AiService } from 'src/ai/service/ai.service';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { ScenarioSessionFeedbacks } from '../../entity/scenario-session-feedbacks.entity';
import { ScenarioSessionEvents } from '../../entity/scenario-session-events.entity';
import { ScenarioEvents } from '../../entity/scenario-events.entity';
import { ScenarioSessions } from '../../entity/scenario-sessions.entity';
import { ScenarioSessionMessages } from '../../entity/scenario-session-messages.entity';
import { ScenarioSessionStatus } from '../../enum/scenario-session-status.enum';
import { ScenarioSessionMessageType } from '../../enum/scenario-session-message.type.enum';
import { ScenarioStatus } from '../../enum/scenario.status.enum';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { EntityOperationException } from 'src/exception/custom.exception';
import { UserRole } from 'src/common/constants/user.constants';
import { StartScenarioSessionRequestDto } from '../../dto/start-scenario-session-request.dto';
import { AddFeedbackToScenarioSessionRequestDto } from '../../dto/add-feedback-to-scenario-session.dto';
import { CreateScenarioEventsDto } from '../../dto/create-scenario-events.dto';
import { DeleteScenarioEventsDto } from '../../dto/delete-scenario-events.dto';
import { MessageRequest } from 'src/ai/dto/ai.request.dto';
import { LearnEventData } from '../../interface/learn-message.interface';

// Mock static classes
jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getTenantId: jest.fn(),
    getUserId: jest.fn(),
    getExecutionId: jest.fn(),
  },
}));

describe('ScenarioSessionService', () => {
  let service: ScenarioSessionService;
  let scenarioSessionRepository: jest.Mocked<ScenarioSessionRepository>;
  let scenarioSessionMessagesRepository: jest.Mocked<ScenarioSessionMessagesRepository>;
  let scenarioService: jest.Mocked<ScenarioService>;
  let livekitService: jest.Mocked<LiveKitService>;
  let sessionEventService: jest.Mocked<SessionEventService>;
  let aiService: jest.Mocked<AiService>;
  let permissionsService: jest.Mocked<PermissionsService>;
  let scenarioSessionFeedbacksRepository: jest.Mocked<
    Repository<ScenarioSessionFeedbacks>
  >;
  let scenarioSessionEventsRepository: jest.Mocked<
    Repository<ScenarioSessionEvents>
  >;
  let scenarioEventsRepository: jest.Mocked<Repository<ScenarioEvents>>;
  let dataSource: jest.Mocked<DataSource>;
  let mockEntityManager: any;

  const mockTenantId = 'tenant-123';
  const mockUserId = 456;
  const mockCounselorId = 123;
  const mockScenarioSessionId = 'session-123';
  const mockRoomId = 'room-123';
  const mockScenarioId = 1;

  const mockScenarioSession: ScenarioSessions = {
    id: mockScenarioSessionId,
    roomId: mockRoomId,
    scenarioId: mockScenarioId,
    counselorId: mockCounselorId,
    status: ScenarioSessionStatus.ACTIVE,
    startedAt: new Date('2024-01-01T10:00:00Z'),
    endedAt: undefined,
    score: undefined,
    metadata: undefined,
    tenantId: mockTenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ScenarioSessions;

  const mockScenario = {
    id: mockScenarioId,
    title: 'Test Scenario',
    scenario: 'Test scenario content',
    description: 'Test scenario description',
    coverImageUrl: 'https://example.com/image.jpg',
    status: ScenarioStatus.ACTIVE,
    prompt: 'You are a counselor',
    metadata: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSessionEvents: SessionEvents[] = [
    {
      id: 'event-1',
      name: 'Event 1',
      description: 'First event',
      score: 10,
      emoji: '🎯',
      message: 'Event 1 message',
      branchInstruction: undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as SessionEvents,
    {
      id: 'event-2',
      name: 'Event 2',
      description: 'Second event',
      score: 15,
      emoji: '🚀',
      message: 'Event 2 message',
      branchInstruction: undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as SessionEvents,
  ];

  const mockPagination = { limit: 10, offset: 0 };

  beforeEach(async () => {
    const mockScenarioSessionRepo = {
      getScenarioSessions: jest.fn(),
      getAdminScenarioSessions: jest.fn(),
      getScenarioSession: jest.fn(),
      createScenarioSession: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      getScenarioSessionScore: jest.fn(),
    };

    const mockScenarioSessionMessagesRepo = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      getMessagesByScenarioSessionId: jest.fn(),
    };

    const mockScenarioService = {
      getScenario: jest.fn(),
    };

    const mockLivekitService = {
      createRoom: jest.fn(),
      deleteRoom: jest.fn(),
      generateAccessToken: jest.fn(),
    };

    const mockSessionEventService = {
      getSessionEventsByScenarioId: jest.fn(),
      findByIds: jest.fn(),
    };

    const mockAiService = {
      getScenarioSessionSummary: jest.fn(),
    };

    const mockPermissionsService = {
      getUserRoles: jest.fn(),
    };

    const mockFeedbackRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    const mockSessionEventsRepo = {
      create: jest.fn(),
      save: jest.fn(),
    };

    const mockEventsRepo = {
      save: jest.fn(),
      delete: jest.fn(),
    };

    mockEntityManager = {
      getRepository: jest.fn(),
    };

    const mockDataSource = {
      transaction: jest.fn(),
    };

    // Setup ExecutionManager mocks
    (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
    (ExecutionManager.getUserId as jest.Mock).mockReturnValue(mockUserId);
    (ExecutionManager.getExecutionId as jest.Mock).mockReturnValue('exec-123');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioSessionService,
        {
          provide: ScenarioSessionRepository,
          useValue: mockScenarioSessionRepo,
        },
        {
          provide: ScenarioSessionMessagesRepository,
          useValue: mockScenarioSessionMessagesRepo,
        },
        {
          provide: ScenarioService,
          useValue: mockScenarioService,
        },
        {
          provide: LiveKitService,
          useValue: mockLivekitService,
        },
        {
          provide: SessionEventService,
          useValue: mockSessionEventService,
        },
        {
          provide: AiService,
          useValue: mockAiService,
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
        {
          provide: getRepositoryToken(ScenarioSessionFeedbacks),
          useValue: mockFeedbackRepo,
        },
        {
          provide: getRepositoryToken(ScenarioSessionEvents),
          useValue: mockSessionEventsRepo,
        },
        {
          provide: getRepositoryToken(ScenarioEvents),
          useValue: mockEventsRepo,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<ScenarioSessionService>(ScenarioSessionService);
    scenarioSessionRepository = module.get(ScenarioSessionRepository);
    scenarioSessionMessagesRepository = module.get(
      ScenarioSessionMessagesRepository,
    );
    scenarioService = module.get(ScenarioService);
    livekitService = module.get(LiveKitService);
    sessionEventService = module.get(SessionEventService);
    aiService = module.get(AiService);
    permissionsService = module.get(PermissionsService);
    scenarioSessionFeedbacksRepository = module.get(
      getRepositoryToken(ScenarioSessionFeedbacks),
    );
    scenarioSessionEventsRepository = module.get(
      getRepositoryToken(ScenarioSessionEvents),
    );
    scenarioEventsRepository = module.get(getRepositoryToken(ScenarioEvents));
    dataSource = module.get(DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getScenarioSessions', () => {
    it('should return scenario sessions with default status', async () => {
      const mockSessions = [mockScenarioSession];
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue(
        mockSessions,
      );

      const result = await service.getScenarioSessions(
        mockCounselorId,
        mockPagination,
      );

      expect(result).toEqual({ data: mockSessions });
      expect(
        scenarioSessionRepository.getScenarioSessions,
      ).toHaveBeenCalledWith(
        mockCounselorId,
        mockPagination,
        ScenarioSessionStatus.ENDED,
      );
    });

    it('should return scenario sessions with custom status', async () => {
      const mockSessions = [mockScenarioSession];
      const customStatus = ScenarioSessionStatus.ACTIVE;
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue(
        mockSessions,
      );

      const result = await service.getScenarioSessions(
        mockCounselorId,
        mockPagination,
        customStatus,
      );

      expect(result).toEqual({ data: mockSessions });
      expect(
        scenarioSessionRepository.getScenarioSessions,
      ).toHaveBeenCalledWith(mockCounselorId, mockPagination, customStatus);
    });
  });

  describe('getAdminScenarioSessions', () => {
    it('should return admin scenario sessions', async () => {
      const mockSessions = [mockScenarioSession];
      scenarioSessionRepository.getAdminScenarioSessions.mockResolvedValue(
        mockSessions,
      );

      const result = await service.getAdminScenarioSessions(mockPagination);

      expect(result).toEqual({ data: mockSessions });
      expect(
        scenarioSessionRepository.getAdminScenarioSessions,
      ).toHaveBeenCalledWith(mockPagination, ScenarioSessionStatus.ENDED);
    });
  });

  describe('getScenarioSession', () => {
    it('should throw BadRequestException when scenario session not found', async () => {
      permissionsService.getUserRoles.mockResolvedValue([UserRole.COUNSELOR]);
      scenarioSessionRepository.getScenarioSession.mockResolvedValue(null);

      await expect(
        service.getScenarioSession(mockScenarioSessionId, mockCounselorId),
      ).rejects.toThrow(new BadRequestException('Scenario session not found'));

      expect(permissionsService.getUserRoles).toHaveBeenCalledWith(
        mockCounselorId,
      );
      expect(scenarioSessionRepository.getScenarioSession).toHaveBeenCalledWith(
        mockScenarioSessionId,
        mockCounselorId,
        false,
      );
    });

    it('should return scenario session with feedback for admin user', async () => {
      const mockFeedback = { id: 'feedback-1', rating: 5 };
      permissionsService.getUserRoles.mockResolvedValue([UserRole.ADMIN]);
      scenarioSessionRepository.getScenarioSession.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioSessionFeedbacksRepository.findOne.mockResolvedValue(
        mockFeedback as any,
      );

      const result = await service.getScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
      );

      expect(result).toEqual({ ...mockScenarioSession, hasFeedback: true });
      expect(scenarioSessionRepository.getScenarioSession).toHaveBeenCalledWith(
        mockScenarioSessionId,
        mockCounselorId,
        true,
      );
    });

    it('should return scenario session without feedback for regular user', async () => {
      permissionsService.getUserRoles.mockResolvedValue([UserRole.COUNSELOR]);
      scenarioSessionRepository.getScenarioSession.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioSessionFeedbacksRepository.findOne.mockResolvedValue(null);

      const result = await service.getScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
      );

      expect(result).toEqual({ ...mockScenarioSession, hasFeedback: false });
      expect(scenarioSessionRepository.getScenarioSession).toHaveBeenCalledWith(
        mockScenarioSessionId,
        mockCounselorId,
        false,
      );
    });
  });

  describe('startScenarioSession', () => {
    const mockStartDto: StartScenarioSessionRequestDto = {
      scenarioId: mockScenarioId,
    };

    it('should throw EntityOperationException when active session exists', async () => {
      const activeSessions = { data: [mockScenarioSession] };
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue(
        activeSessions.data,
      );

      await expect(
        service.startScenarioSession(mockCounselorId, mockStartDto),
      ).rejects.toThrow(EntityOperationException);

      expect(
        scenarioSessionRepository.getScenarioSessions,
      ).toHaveBeenCalledWith(
        mockCounselorId,
        { limit: 1, offset: 0 },
        ScenarioSessionStatus.ACTIVE,
      );
    });

    it('should throw BadRequestException when scenario has no lifeHistory', async () => {
      const mockScenarioWithoutLifeHistory = {
        ...mockScenario,
        metadata: {
          difficulty: 'beginner',
          tags: ['test'],
        },
      };
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue([]);
      scenarioService.getScenario.mockResolvedValue(
        mockScenarioWithoutLifeHistory,
      );
      sessionEventService.getSessionEventsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );
      scenarioSessionRepository.createScenarioSession.mockResolvedValue(
        mockScenarioSession,
      );

      await expect(
        service.startScenarioSession(mockCounselorId, mockStartDto),
      ).rejects.toThrow(
        new BadRequestException(
          'Scenario details are not complete. Please contact admin.',
        ),
      );
    });

    it('should throw BadRequestException when scenario metadata is null', async () => {
      const mockScenarioWithNullMetadata = {
        ...mockScenario,
        metadata: null,
      };
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue([]);
      scenarioService.getScenario.mockResolvedValue(
        mockScenarioWithNullMetadata as any,
      );
      sessionEventService.getSessionEventsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );
      scenarioSessionRepository.createScenarioSession.mockResolvedValue(
        mockScenarioSession,
      );

      await expect(
        service.startScenarioSession(mockCounselorId, mockStartDto),
      ).rejects.toThrow(
        new BadRequestException(
          'Scenario details are not complete. Please contact admin.',
        ),
      );
    });

    it('should successfully start scenario session with default ttl', async () => {
      const mockTokenResponse = {
        token: 'access-token-123',
        roomName: mockRoomId,
        serverUrl: 'https://livekit.example.com',
      };
      const mockScenarioWithMetadata = {
        ...mockScenario,
        metadata: {
          difficulty: 'intermediate',
          tags: ['anxiety'],
          lifeHistory: { age: 25, background: 'test' },
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue([]);
      scenarioService.getScenario.mockResolvedValue(mockScenarioWithMetadata);
      sessionEventService.getSessionEventsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );
      scenarioSessionRepository.createScenarioSession.mockResolvedValue(
        mockScenarioSession,
      );
      livekitService.createRoom.mockResolvedValue({} as any);
      livekitService.generateAccessToken.mockResolvedValue(mockTokenResponse);

      const result = await service.startScenarioSession(
        mockCounselorId,
        mockStartDto,
      );

      expect(result).toEqual({
        scenarioSession: mockScenarioSession,
        accessToken: mockTokenResponse,
      });
      expect(livekitService.createRoom).toHaveBeenCalledWith({
        name: mockRoomId,
        ttl: 1800,
        metadata: {
          version: '1.0',
          tenantId: mockTenantId,
          scenario: {
            ...mockScenarioWithMetadata,
            metadata: {
              difficulty: 'intermediate',
              tags: ['anxiety'],
            },
            lifeHistory: { age: 25, background: 'test' },
            events: mockSessionEvents,
          },
        },
      });
    });

    it('should successfully start scenario session with custom ttl', async () => {
      const mockTokenResponse = {
        token: 'access-token-123',
        roomName: mockRoomId,
        serverUrl: 'https://livekit.example.com',
      };
      const customTtl = 3600;
      const mockStartDtoWithTtl = { ...mockStartDto, ttl: customTtl };
      const mockScenarioWithMetadata = {
        ...mockScenario,
        metadata: {
          difficulty: 'beginner',
          lifeHistory: { age: 30, background: 'test background' },
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue([]);
      scenarioService.getScenario.mockResolvedValue(mockScenarioWithMetadata);
      sessionEventService.getSessionEventsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );
      scenarioSessionRepository.createScenarioSession.mockResolvedValue(
        mockScenarioSession,
      );
      livekitService.createRoom.mockResolvedValue({} as any);
      livekitService.generateAccessToken.mockResolvedValue(mockTokenResponse);

      const result = await service.startScenarioSession(
        mockCounselorId,
        mockStartDtoWithTtl,
      );

      expect(result).toEqual({
        scenarioSession: mockScenarioSession,
        accessToken: mockTokenResponse,
      });
      expect(livekitService.createRoom).toHaveBeenCalledWith(
        expect.objectContaining({
          name: mockRoomId,
          ttl: customTtl,
        }),
      );
    });
  });

  describe('mapEventsToScenario', () => {
    const mockCreateDto: CreateScenarioEventsDto = {
      scenarioId: mockScenarioId,
      eventIds: ['event-1', 'event-2'],
    };

    it('should throw BadRequestException when eventIds array is empty', async () => {
      const emptyDto = { ...mockCreateDto, eventIds: [] };

      await expect(service.mapEventsToScenario(emptyDto)).rejects.toThrow(
        new BadRequestException('Event IDs array cannot be empty'),
      );
    });

    it('should throw BadRequestException when invalid event IDs provided', async () => {
      const validEvents = [
        {
          id: 'event-1',
          name: 'Event 1',
          description: 'First event',
          score: 10,
          emoji: '🎯',
          message: 'Event 1 message',
        } as SessionEvents,
      ];
      scenarioService.getScenario.mockResolvedValue(mockScenario);
      sessionEventService.findByIds.mockResolvedValue(validEvents);

      await expect(service.mapEventsToScenario(mockCreateDto)).rejects.toThrow(
        new BadRequestException('Invalid event IDs: event-2'),
      );
    });

    it('should successfully map events to scenario', async () => {
      const validEvents = [
        {
          id: 'event-1',
          name: 'Event 1',
          description: 'First event',
          score: 10,
          emoji: '🎯',
          message: 'Event 1 message',
        } as SessionEvents,
        {
          id: 'event-2',
          name: 'Event 2',
          description: 'Second event',
          score: 15,
          emoji: '🚀',
          message: 'Event 2 message',
        } as SessionEvents,
      ];
      const expectedScenarioEvents = [
        {
          scenarioId: mockScenarioId,
          eventId: 'event-1',
          tenantId: mockTenantId,
        },
        {
          scenarioId: mockScenarioId,
          eventId: 'event-2',
          tenantId: mockTenantId,
        },
      ];

      scenarioService.getScenario.mockResolvedValue(mockScenario);
      sessionEventService.findByIds.mockResolvedValue(validEvents);
      scenarioEventsRepository.save.mockResolvedValue(
        expectedScenarioEvents as any,
      );

      const result = await service.mapEventsToScenario(mockCreateDto);

      expect(result).toEqual(expectedScenarioEvents);
      expect(scenarioEventsRepository.save).toHaveBeenCalledWith(
        expectedScenarioEvents,
      );
    });
  });

  describe('deleteScenarioEvents', () => {
    const mockDeleteDto: DeleteScenarioEventsDto = {
      scenarioId: mockScenarioId,
      eventIds: ['event-1', 'event-2'],
    };

    it('should throw BadRequestException when eventIds array is empty', async () => {
      const emptyDto = { ...mockDeleteDto, eventIds: [] };

      await expect(service.deleteScenarioEvents(emptyDto)).rejects.toThrow(
        new BadRequestException('Event IDs array cannot be empty'),
      );
    });

    it('should throw BadRequestException when no scenario events found to delete', async () => {
      scenarioService.getScenario.mockResolvedValue(mockScenario);
      scenarioEventsRepository.delete.mockResolvedValue({ affected: 0 } as any);

      await expect(service.deleteScenarioEvents(mockDeleteDto)).rejects.toThrow(
        new BadRequestException('No scenario events found to delete'),
      );
    });

    it('should successfully delete scenario events', async () => {
      scenarioService.getScenario.mockResolvedValue(mockScenario);
      scenarioEventsRepository.delete.mockResolvedValue({ affected: 2 } as any);

      const result = await service.deleteScenarioEvents(mockDeleteDto);

      expect(result).toBe(2);
      expect(scenarioEventsRepository.delete).toHaveBeenCalledWith({
        eventId: In(mockDeleteDto.eventIds),
        scenarioId: mockScenarioId,
      });
    });
  });

  describe('endScenarioSession', () => {
    it('should throw BadRequestException when scenario session not found', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(null);

      await expect(
        service.endScenarioSession(mockScenarioSessionId, mockCounselorId),
      ).rejects.toThrow(new BadRequestException('Scenario session not found'));
    });

    it('should throw BadRequestException when scenario session is not active', async () => {
      const inactiveSession = {
        ...mockScenarioSession,
        status: ScenarioSessionStatus.ENDED,
      };
      scenarioSessionRepository.findOne.mockResolvedValue(inactiveSession);

      await expect(
        service.endScenarioSession(mockScenarioSessionId, mockCounselorId),
      ).rejects.toThrow(
        new BadRequestException('Scenario session is not active'),
      );
    });

    it('should successfully end scenario session with room deletion error', async () => {
      const mockScore = 85.5;
      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);
      scenarioSessionRepository.getScenarioSessionScore.mockResolvedValue(
        mockScore,
      );
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);
      livekitService.deleteRoom.mockRejectedValue(
        new Error('Room deletion failed'),
      );

      const result = await service.endScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
      );

      expect(result).toEqual({
        message: 'Scenario session ended successfully',
      });
      expect(scenarioSessionRepository.update).toHaveBeenCalledWith(
        mockScenarioSessionId,
        expect.objectContaining({
          status: ScenarioSessionStatus.ENDED,
          score: mockScore,
        }),
      );
    });

    it('should successfully end scenario session', async () => {
      const mockScore = 85.5;
      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);
      scenarioSessionRepository.getScenarioSessionScore.mockResolvedValue(
        mockScore,
      );
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);
      livekitService.deleteRoom.mockResolvedValue(undefined);

      const result = await service.endScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
      );

      expect(result).toEqual({
        message: 'Scenario session ended successfully',
      });
      expect(livekitService.deleteRoom).toHaveBeenCalledWith(mockRoomId);
    });

    it('should successfully end scenario session with call duration calculation', async () => {
      const mockScore = 85.5;
      const sessionWithEndDate = {
        ...mockScenarioSession,
        endedAt: new Date('2024-01-01T11:00:00Z'), // 1 hour after start
      };
      scenarioSessionRepository.findOne.mockResolvedValue(sessionWithEndDate);
      scenarioSessionRepository.getScenarioSessionScore.mockResolvedValue(
        mockScore,
      );
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);
      livekitService.deleteRoom.mockResolvedValue(undefined);

      const result = await service.endScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
      );

      expect(result).toEqual({
        message: 'Scenario session ended successfully',
      });
      expect(scenarioSessionRepository.update).toHaveBeenCalledWith(
        mockScenarioSessionId,
        expect.objectContaining({
          status: ScenarioSessionStatus.ENDED,
          score: mockScore,
        }),
      );
    });

    it('should handle zero call duration fallback', async () => {
      const mockScore = 85.5;
      const sessionWithStartTime = {
        ...mockScenarioSession,
        startedAt: new Date('2024-01-01T10:00:00Z'),
        endedAt: new Date('2024-01-01T10:00:00Z'),
      };
      scenarioSessionRepository.findOne.mockResolvedValue(sessionWithStartTime);
      scenarioSessionRepository.getScenarioSessionScore.mockResolvedValue(
        mockScore,
      );
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);
      livekitService.deleteRoom.mockResolvedValue(undefined);

      // Mock Date constructor to return a date that when subtracted gives 0
      const originalDate = global.Date;
      const mockDate = jest.fn(() => ({
        getTime: () => sessionWithStartTime.startedAt!.getTime(), // Same time as startedAt
      }));
      (global as any).Date = mockDate;

      const result = await service.endScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
      );

      expect(result).toEqual({
        message: 'Scenario session ended successfully',
      });

      // Restore original Date
      global.Date = originalDate;
    });
  });

  describe('generateScenarioSessionToken', () => {
    it('should generate access token', async () => {
      const mockTokenResponse = {
        token: 'access-token-123',
        roomName: mockRoomId,
        serverUrl: 'https://livekit.example.com',
      };
      livekitService.generateAccessToken.mockResolvedValue(mockTokenResponse);

      const result = await service.generateScenarioSessionToken(
        mockRoomId,
        mockCounselorId,
      );

      expect(result).toEqual(mockTokenResponse);
      expect(livekitService.generateAccessToken).toHaveBeenCalledWith({
        roomName: mockRoomId,
        participantName: mockCounselorId.toString(),
      });
    });
  });

  describe('addFeedbackToScenarioSession', () => {
    const mockFeedbackDto: AddFeedbackToScenarioSessionRequestDto = {
      rating: 5,
      feedback: 'Great session',
    };

    it('should throw BadRequestException when scenario session not found', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(null);

      await expect(
        service.addFeedbackToScenarioSession(
          mockScenarioSessionId,
          mockCounselorId,
          mockFeedbackDto,
        ),
      ).rejects.toThrow(new BadRequestException('Scenario session not found'));
    });

    it('should throw BadRequestException when scenario session is not ended', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);

      await expect(
        service.addFeedbackToScenarioSession(
          mockScenarioSessionId,
          mockCounselorId,
          mockFeedbackDto,
        ),
      ).rejects.toThrow(
        new BadRequestException('Scenario session is not ended'),
      );
    });

    it('should throw BadRequestException when counselor is not authorized', async () => {
      const endedSession = {
        ...mockScenarioSession,
        status: ScenarioSessionStatus.ENDED,
        counselorId: 999,
      };
      scenarioSessionRepository.findOne.mockResolvedValue(endedSession);

      await expect(
        service.addFeedbackToScenarioSession(
          mockScenarioSessionId,
          mockCounselorId,
          mockFeedbackDto,
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'You are not authorized to add feedback to this scenario session',
        ),
      );
    });

    it('should throw BadRequestException when feedback already exists', async () => {
      const endedSession = {
        ...mockScenarioSession,
        status: ScenarioSessionStatus.ENDED,
      };
      const existingFeedback = { id: 'feedback-1' };
      scenarioSessionRepository.findOne.mockResolvedValue(endedSession);
      scenarioSessionFeedbacksRepository.findOne.mockResolvedValue(
        existingFeedback as any,
      );

      await expect(
        service.addFeedbackToScenarioSession(
          mockScenarioSessionId,
          mockCounselorId,
          mockFeedbackDto,
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Feedback already exists for this scenario session',
        ),
      );
    });

    it('should successfully add feedback to scenario session', async () => {
      const endedSession = {
        ...mockScenarioSession,
        status: ScenarioSessionStatus.ENDED,
      };
      const mockCreatedFeedback = { id: 'feedback-1', ...mockFeedbackDto };
      scenarioSessionRepository.findOne.mockResolvedValue(endedSession);
      scenarioSessionFeedbacksRepository.findOne.mockResolvedValue(null);
      scenarioSessionFeedbacksRepository.create.mockReturnValue(
        mockCreatedFeedback as any,
      );
      scenarioSessionFeedbacksRepository.save.mockResolvedValue(
        mockCreatedFeedback as any,
      );

      const result = await service.addFeedbackToScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
        mockFeedbackDto,
      );

      expect(result).toEqual(mockCreatedFeedback);
      expect(scenarioSessionFeedbacksRepository.create).toHaveBeenCalledWith({
        scenarioSessionId: mockScenarioSessionId,
        rating: mockFeedbackDto.rating,
        feedback: mockFeedbackDto.feedback,
        tenantId: mockTenantId,
      });
    });
  });

  describe('getScenarioSessionByRoomId', () => {
    it('should throw BadRequestException when scenario session not found', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getScenarioSessionByRoomId(mockRoomId),
      ).rejects.toThrow(new BadRequestException('Scenario session not found'));
    });

    it('should return scenario session by room ID', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);

      const result = await service.getScenarioSessionByRoomId(mockRoomId);

      expect(result).toEqual(mockScenarioSession);
      expect(scenarioSessionRepository.findOne).toHaveBeenCalledWith({
        where: { roomId: mockRoomId },
      });
    });
  });

  describe('addScenarioSessionMessage', () => {
    it('should add scenario session message for CLIENT role', async () => {
      const mockChatMessage: MessageRequest = {
        role: 'CLIENT',
        content: 'Test message',
        start_time: 10.5,
        end_time: 15.2,
      };
      const mockCreatedMessage = { id: 1, content: 'Test message' };

      scenarioSessionMessagesRepository.create.mockReturnValue(
        mockCreatedMessage as any,
      );
      scenarioSessionMessagesRepository.save.mockResolvedValue(
        mockCreatedMessage as any,
      );

      const result = await service.addScenarioSessionMessage(
        mockScenarioSessionId,
        mockCounselorId,
        mockChatMessage,
        mockTenantId,
      );

      expect(result).toEqual(mockCreatedMessage);
      expect(scenarioSessionMessagesRepository.create).toHaveBeenCalledWith({
        scenarioSessionId: mockScenarioSessionId,
        senderId: -1,
        content: mockChatMessage.content,
        messageType: ScenarioSessionMessageType.TEXT,
        startSeconds: mockChatMessage.start_time,
        endSeconds: mockChatMessage.end_time,
        tenantId: mockTenantId,
      });
    });

    it('should add scenario session message for COUNSELOR role', async () => {
      const mockChatMessage: MessageRequest = {
        role: 'COUNSELOR',
        content: 'Test response',
        start_time: 20.1,
        end_time: 25.8,
      };
      const mockCreatedMessage = { id: 2, content: 'Test response' };

      scenarioSessionMessagesRepository.create.mockReturnValue(
        mockCreatedMessage as any,
      );
      scenarioSessionMessagesRepository.save.mockResolvedValue(
        mockCreatedMessage as any,
      );

      const result = await service.addScenarioSessionMessage(
        mockScenarioSessionId,
        mockCounselorId,
        mockChatMessage,
        mockTenantId,
      );

      expect(result).toEqual(mockCreatedMessage);
      expect(scenarioSessionMessagesRepository.create).toHaveBeenCalledWith({
        scenarioSessionId: mockScenarioSessionId,
        senderId: mockCounselorId,
        content: mockChatMessage.content,
        messageType: ScenarioSessionMessageType.TEXT,
        startSeconds: mockChatMessage.start_time,
        endSeconds: mockChatMessage.end_time,
        tenantId: mockTenantId,
      });
    });
  });

  describe('getMessagesByScenarioSessionId', () => {
    it('should return messages by scenario session ID', async () => {
      const mockMessages = [
        {
          id: 1,
          scenarioSessionId: mockScenarioSessionId,
          senderId: mockCounselorId,
          messageType: ScenarioSessionMessageType.TEXT,
          content: 'Message 1',
          metadata: undefined,
          startSeconds: 10.5,
          endSeconds: 15.2,
          tenantId: mockTenantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ScenarioSessionMessages,
        {
          id: 2,
          scenarioSessionId: mockScenarioSessionId,
          senderId: -1,
          messageType: ScenarioSessionMessageType.TEXT,
          content: 'Message 2',
          metadata: undefined,
          startSeconds: 16.0,
          endSeconds: 20.5,
          tenantId: mockTenantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ScenarioSessionMessages,
      ];
      scenarioSessionMessagesRepository.getMessagesByScenarioSessionId.mockResolvedValue(
        mockMessages,
      );

      const result = await service.getMessagesByScenarioSessionId(
        mockScenarioSessionId,
        mockPagination,
      );

      expect(result).toEqual({ messages: mockMessages });
      expect(
        scenarioSessionMessagesRepository.getMessagesByScenarioSessionId,
      ).toHaveBeenCalledWith(mockScenarioSessionId, mockPagination);
    });
  });

  describe('addScenarioSessionEvent', () => {
    it('should add scenario session event', async () => {
      const mockEvent: LearnEventData = {
        event_id: 'event-123',
        timestamp: new Date('2024-01-01T12:00:00Z'),
      };
      const mockCreatedEvent = { id: 1, eventId: 'event-123' };

      scenarioSessionEventsRepository.create.mockReturnValue(
        mockCreatedEvent as any,
      );
      scenarioSessionEventsRepository.save.mockResolvedValue(
        mockCreatedEvent as any,
      );

      const result = await service.addScenarioSessionEvent(
        mockScenarioSessionId,
        mockEvent,
        mockTenantId,
      );

      expect(result).toEqual(mockCreatedEvent);
      expect(scenarioSessionEventsRepository.create).toHaveBeenCalledWith({
        scenarioSessionId: mockScenarioSessionId,
        eventId: mockEvent.event_id,
        occurredAt: mockEvent.timestamp,
        tenantId: mockTenantId,
      });
    });
  });

  describe('getScenarioSessionSummaryFromAI', () => {
    it('should handle scenario with no messages', async () => {
      const mockScenarioSessionMessagesRepo = {
        find: jest.fn().mockResolvedValue([]),
      };
      mockEntityManager.getRepository.mockReturnValue(
        mockScenarioSessionMessagesRepo,
      );
      dataSource.transaction.mockImplementation(async (callback: any) =>
        callback(mockEntityManager),
      );

      // Call the private method through endScenarioSession to test the path
      const mockScore = 85.5;
      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);
      scenarioSessionRepository.getScenarioSessionScore.mockResolvedValue(
        mockScore,
      );
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);
      livekitService.deleteRoom.mockResolvedValue(undefined);

      await service.endScenarioSession(mockScenarioSessionId, mockCounselorId);

      // Add a small delay to allow the async method to execute
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockScenarioSessionMessagesRepo.find).toHaveBeenCalledWith({
        where: {
          scenarioSessionId: mockScenarioSessionId,
          messageType: ScenarioSessionMessageType.TEXT,
          tenantId: mockTenantId,
        },
      });
    });

    it('should generate AI summary when messages exist', async () => {
      const mockMessages = [
        {
          senderId: mockCounselorId,
          content: 'Hello, how are you?',
          startSeconds: 10.5,
          endSeconds: 15.2,
        },
        {
          senderId: -1,
          content: 'I am feeling anxious',
          startSeconds: 16.0,
          endSeconds: 20.5,
        },
      ];
      const mockSummary = 'AI generated summary';
      const mockScenarioSessionMessagesRepo = {
        find: jest.fn().mockResolvedValue(mockMessages),
      };
      const mockScenarioSessionDetailsRepo = {
        create: jest.fn().mockReturnValue({ id: 'details-1' }),
        save: jest.fn().mockResolvedValue({ id: 'details-1' }),
      };

      mockEntityManager.getRepository
        .mockReturnValueOnce(mockScenarioSessionMessagesRepo)
        .mockReturnValueOnce(mockScenarioSessionDetailsRepo);

      dataSource.transaction.mockImplementation(async (callback: any) =>
        callback(mockEntityManager),
      );
      aiService.getScenarioSessionSummary.mockResolvedValue(mockSummary);

      // Call through endScenarioSession
      const mockScore = 85.5;
      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);
      scenarioSessionRepository.getScenarioSessionScore.mockResolvedValue(
        mockScore,
      );
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);
      livekitService.deleteRoom.mockResolvedValue(undefined);

      // Mock getScenario to be called within the transaction
      scenarioService.getScenario.mockResolvedValue(mockScenario);

      await service.endScenarioSession(mockScenarioSessionId, mockCounselorId);

      // Add a small delay to allow the async method to execute
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(aiService.getScenarioSessionSummary).toHaveBeenCalledWith(
        [
          {
            role: 'COUNSELLOR',
            content: 'Hello, how are you?',
            start_time: 10.5,
            end_time: 15.2,
          },
          {
            role: 'CLIENT',
            content: 'I am feeling anxious',
            start_time: 16.0,
            end_time: 20.5,
          },
        ],
        mockScenario.description,
      );
      expect(mockScenarioSessionDetailsRepo.save).toHaveBeenCalled();
    });
  });
});
