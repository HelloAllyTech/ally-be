import { Test, TestingModule } from '@nestjs/testing';
import { LearnController } from '../learn.controller';
import { ScenarioService } from '../../service/scenario.service';
import { ScenarioSessionService } from '../../service/scenario-session.service';
import { SortOrder } from 'src/chat/dto/call-log.request.dto';
import { ScenarioSessionSortBy } from '../../enum/scenario-session-sort-by.enum';
import { TokenUser } from 'src/auth/type/auth.types';
import { ScenarioStatus } from '../../enum/scenario.status.enum';
import { ScenarioSessionStatus } from '../../enum/scenario-session-status.enum';
import { ScenarioSessionMessageType } from '../../enum/scenario-session-message.type.enum';
import { UserInfo } from 'src/chat/dto/call-log.response.dto';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { ScenarioSortBy } from 'src/learn/enum/scenario-sort-by.enum';
import { DeleteCoverImageDto } from 'src/learn/dto/delete-cover-image.dto';
import { DeleteCoverVideoDto } from 'src/learn/dto/delete-cover-video.dto';
import { ScenarioVideoUploadRequestDto } from 'src/learn/dto/scenario-video-upload-request.dto';
import { ScenarioVideoUploadContentType } from 'src/learn/enum/scenario-video-upload-content-type';

describe('LearnController', () => {
  let controller: LearnController;
  let scenarioService: jest.Mocked<ScenarioService>;
  let scenarioSessionService: jest.Mocked<ScenarioSessionService>;

  const mockTokenUser: TokenUser = {
    id: 123,
    username: 'test@example.com',
    tenantId: 'tenant-123',
  };

  const mockScenarioResponse = {
    id: 1,
    title: 'Test Scenario',
    scenario: 'Test Scenario Content',
    description: 'Test Description',
    coverImageUrl: 'https://example.com/cover.jpg',
    status: ScenarioStatus.ACTIVE,
    prompt: 'You are a counselor',
    metadata: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockScenarios = [mockScenarioResponse];

  const mockUserInfo: UserInfo = {
    id: 123,
    name: 'Test User',
    email: 'test@example.com',
    role: 'LEARNER',
  };

  const mockScenarioSessionResponse = {
    id: 'session-123',
    roomId: 'room-123',
    scenarioId: 1,
    counselorId: 123,
    status: ScenarioSessionStatus.ENDED,
    startedAt: new Date(),
    endedAt: new Date(),
    score: 85,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    tenantId: 'tenant-123',
    scenario: mockScenarioResponse,
    counselor: mockUserInfo,
  };

  const mockCreateScenariosDto = {
    scenarios: [
      {
        title: 'New Scenario',
        scenario: 'New Scenario Content',
        description: 'New Description',
        coverImageUrl: 'https://example.com/new-cover.jpg',
        status: ScenarioStatus.ACTIVE,
        prompt: 'Test prompt',
        metadata: {},
      },
    ],
  };

  const mockUpdateScenarioDto = {
    title: 'Updated Scenario',
    scenario: 'Updated Scenario Content',
    description: 'Updated Description',
    coverImageUrl: 'https://example.com/updated-cover.jpg',
    status: ScenarioStatus.ACTIVE,
    prompt: 'Updated prompt',
    metadata: {},
  };

  const mockStartScenarioSessionDto = {
    scenarioId: 1,
  };

  const mockAddFeedbackDto = {
    rating: 5,
    feedback: 'Great session',
  };

  const mockCreateScenarioEventsDto = {
    scenarioId: 1,
    events: [
      {
        id: 'event1',
        feedbackStatus: undefined,
        score: undefined,
        emoji: undefined,
        message: undefined,
        branchingStatus: undefined,
        branchInstruction: undefined,
      },
      {
        id: 'event2',
        feedbackStatus: undefined,
        score: undefined,
        emoji: undefined,
        message: undefined,
        branchingStatus: undefined,
        branchInstruction: undefined,
      },
      {
        id: 'event3',
        feedbackStatus: undefined,
        score: undefined,
        emoji: undefined,
        message: undefined,
        branchingStatus: undefined,
        branchInstruction: undefined,
      },
    ],
  };

  const mockDeleteScenarioEventsDto = {
    scenarioId: 1,
    eventIds: ['event1', 'event2'],
  };

  beforeEach(async () => {
    const mockScenarioService = {
      getScenarios: jest.fn(),
      getScenario: jest.fn(),
      getAdminScenarios: jest.fn(),
      getAdminScenario: jest.fn(),
      deleteAdminScenario: jest.fn(),
      getPresignedUrlForScenarioCoverImage: jest.fn(),
      getPresignedUrlForScenarioCoverVideo: jest.fn(),
      createScenarios: jest.fn(),
      updateScenario: jest.fn(),
      mapEventsToScenario: jest.fn(),
      deleteScenarioEvents: jest.fn(),
      getScenarioEvents: jest.fn(),
      getScenarioVoices: jest.fn(),
      createScenarioVoice: jest.fn(),
      createScenarioVoices: jest.fn(),
      updateScenarioVoice: jest.fn(),
      deleteCoverImage: jest.fn(),
      deleteCoverVideo: jest.fn(),
    };

    const mockScenarioSessionService = {
      getScenarioSessions: jest.fn(),
      getAdminScenarioSessions: jest.fn(),
      getScenarioSession: jest.fn(),
      startScenarioSession: jest.fn(),
      previewScenario: jest.fn(),
      endPreviewScenario: jest.fn(),
      endScenarioSession: jest.fn(),
      addFeedbackToScenarioSession: jest.fn(),
      getMessagesByScenarioSessionId: jest.fn(),
    };

    const mockPermissionsService = {
      getUserRoles: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LearnController],
      providers: [
        {
          provide: ScenarioService,
          useValue: mockScenarioService,
        },
        {
          provide: ScenarioSessionService,
          useValue: mockScenarioSessionService,
        },
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
      ],
    }).compile();

    controller = module.get<LearnController>(LearnController);
    scenarioService = module.get(ScenarioService);
    scenarioSessionService = module.get(ScenarioSessionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getScenarios', () => {
    it('should return all scenarios', async () => {
      scenarioService.getScenarios.mockResolvedValue(mockScenarios);

      const result = await controller.getScenarios();

      expect(result).toEqual(mockScenarios);

      expect(scenarioService.getScenarios).toHaveBeenCalledTimes(1);
      expect(scenarioService.getScenarios).toHaveBeenCalledWith();
    });

    it('should return empty array when no scenarios exist', async () => {
      scenarioService.getScenarios.mockResolvedValue([]);

      const result = await controller.getScenarios();

      expect(result).toEqual([]);
      expect(scenarioService.getScenarios).toHaveBeenCalledTimes(1);
    });
  });

  describe('getAdminScenarios', () => {
    const mockAdminScenariosData = {
      data: [
        {
          id: 2,
          title: 'Conflict Resolution Training',
          createdAt: new Date('2025-09-15T00:42:44.969Z'),
          updatedAt: new Date('2025-09-15T00:42:44.969Z'),
          scenario: 'Simulate mediation between two conflicting clients',
          description:
            'A scenario for learning how to mediate conflicts between two clients.',
          coverImageUrl: 'https://example.com/conflict.png',
          coverVideoUrl: 'https://example.com/conflict.mp4',
          createdBy: 'user1',
          status: 'ACTIVE',
          usage: '2',
          isPreviewEnabled: false,
        },
        {
          id: 3,
          title: 'Sales Pitch Practice',
          createdAt: new Date('2025-09-15T00:42:44.969Z'),
          updatedAt: new Date('2025-09-15T00:42:44.969Z'),
          scenario: 'Simulate a meeting with a potential client',
          description:
            'Simulates a client meeting to practice delivering a persuasive sales pitch.',
          coverImageUrl: 'https://example.com/sales.png',
          coverVideoUrl: 'https://example.com/conflict.mp4',
          createdBy: 'Jane Smith',
          status: 'DRAFT',
          usage: '1',
          isPreviewEnabled: true,
        },
      ],
    };

    it('should return admin scenarios with default parameters', async () => {
      scenarioService.getAdminScenarios.mockResolvedValue(
        mockAdminScenariosData,
      );

      const result = await controller.getAdminScenarios();

      expect(result).toEqual(mockAdminScenariosData);
      expect(scenarioService.getAdminScenarios).toHaveBeenCalledTimes(1);
      expect(scenarioService.getAdminScenarios).toHaveBeenCalledWith(
        undefined,
        {
          limit: undefined,
          offset: undefined,
          sortBy: ScenarioSortBy.CREATED_AT,
          order: SortOrder.ASC,
        },
      );
    });

    it('should return admin scenarios with status filter', async () => {
      scenarioService.getAdminScenarios.mockResolvedValue(
        mockAdminScenariosData,
      );

      const result = await controller.getAdminScenarios(
        undefined,
        undefined,
        ScenarioSortBy.CREATED_AT,
        SortOrder.DESC,
        'ACTIVE',
      );

      expect(result).toEqual(mockAdminScenariosData);
      expect(scenarioService.getAdminScenarios).toHaveBeenCalledWith('ACTIVE', {
        limit: undefined,
        offset: undefined,
        sortBy: ScenarioSortBy.CREATED_AT,
        order: SortOrder.DESC,
      });
    });

    it('should return admin scenarios with pagination parameters', async () => {
      const limit = 10;
      const offset = 0;

      scenarioService.getAdminScenarios.mockResolvedValue(
        mockAdminScenariosData,
      );

      const result = await controller.getAdminScenarios(
        limit,
        offset,
        ScenarioSortBy.CREATED_AT,
        SortOrder.DESC,
      );

      expect(result).toEqual(mockAdminScenariosData);
      expect(scenarioService.getAdminScenarios).toHaveBeenCalledWith(
        undefined,
        {
          limit,
          offset,
          sortBy: ScenarioSortBy.CREATED_AT,
          order: SortOrder.DESC,
        },
      );
    });

    it('should return admin scenarios with all custom parameters', async () => {
      const limit = 20;
      const offset = 10;
      const sortBy = ScenarioSortBy.ID;
      const order = SortOrder.ASC;
      const status = 'ACTIVE,DRAFT';

      scenarioService.getAdminScenarios.mockResolvedValue(
        mockAdminScenariosData,
      );

      const result = await controller.getAdminScenarios(
        limit,
        offset,
        sortBy,
        order,
        status,
      );

      expect(result).toEqual(mockAdminScenariosData);
      expect(scenarioService.getAdminScenarios).toHaveBeenCalledWith(status, {
        limit,
        offset,
        sortBy,
        order,
      });
    });

    it('should return empty data array when no scenarios found', async () => {
      scenarioService.getAdminScenarios.mockResolvedValue({ data: [] });

      const result = await controller.getAdminScenarios();

      expect(result).toEqual({ data: [] });
    });

    it('should handle multiple status filters', async () => {
      scenarioService.getAdminScenarios.mockResolvedValue(
        mockAdminScenariosData,
      );

      await controller.getAdminScenarios(
        undefined,
        undefined,
        ScenarioSortBy.CREATED_AT,
        SortOrder.DESC,
        'ACTIVE,DRAFT',
      );

      expect(scenarioService.getAdminScenarios).toHaveBeenCalledWith(
        'ACTIVE,DRAFT',
        expect.any(Object),
      );
    });
  });

  describe('getScenario', () => {
    it('should return a scenario by id', async () => {
      const scenarioId = 1;
      scenarioService.getScenario.mockResolvedValue(mockScenarioResponse);

      const result = await controller.getScenario(scenarioId);

      expect(result).toEqual(mockScenarioResponse);

      expect(scenarioService.getScenario).toHaveBeenCalledTimes(1);
      expect(scenarioService.getScenario).toHaveBeenCalledWith(scenarioId, [
        'id',
        'title',
        'scenario',
        'description',
        'coverImageUrl',
        'coverVideoUrl',
        'status',
      ]);
    });

    it('should call getScenario with correct select fields', async () => {
      const scenarioId = 5;
      scenarioService.getScenario.mockResolvedValue(mockScenarioResponse);

      await controller.getScenario(scenarioId);

      expect(scenarioService.getScenario).toHaveBeenCalledWith(scenarioId, [
        'id',
        'title',
        'scenario',
        'description',
        'coverImageUrl',
        'coverVideoUrl',
        'status',
      ]);
    });
  });

  describe('getAdminScenario', () => {
    it('should return a scenario by id for admin', async () => {
      const scenarioId = 1;
      const mockScenario = mockScenarios[0];
      scenarioService.getAdminScenario.mockResolvedValue(mockScenario);

      const result = await controller.getAdminScenario(scenarioId);

      expect(result).toEqual(mockScenario);
      expect(scenarioService.getAdminScenario).toHaveBeenCalledWith(scenarioId);
    });
  });

  describe('getPresignedUrlForScenarioCoverImage', () => {
    it('should return presigned URL for scenario cover image', async () => {
      const requestDto = {
        fileName: 'test.jpg',
        fileSize: 1024,
        contentType: 'image/jpeg' as any,
      };
      const expectedResponse = {
        presignedUrl: 'https://presigned-url.com',
        coverImageUrl:
          'https://test-bucket.s3.us-east-1.amazonaws.com/scenario-cover-images/1234567890-test.jpg',
      };
      scenarioService.getPresignedUrlForScenarioCoverImage.mockResolvedValue(
        expectedResponse,
      );

      const result =
        await controller.getPresignedUrlForScenarioCoverImage(requestDto);

      expect(result).toEqual(expectedResponse);
      expect(
        scenarioService.getPresignedUrlForScenarioCoverImage,
      ).toHaveBeenCalledWith(requestDto);
    });
  });

  describe('deleteAdminScenario', () => {
    it('should delete a scenario by id', async () => {
      const scenarioId = 1;
      scenarioService.deleteAdminScenario.mockResolvedValue(true);

      const result = await controller.deleteAdminScenario(scenarioId);

      expect(result).toBe(true);
      expect(scenarioService.deleteAdminScenario).toHaveBeenCalledWith(
        scenarioId,
      );
    });
  });

  describe('createScenario', () => {
    it('should create multiple scenarios', async () => {
      scenarioService.createScenarios.mockResolvedValue(mockScenarios as any);

      const result = await controller.createScenario(
        mockTokenUser,
        mockCreateScenariosDto,
      );

      expect(result).toEqual(mockScenarios);

      expect(scenarioService.createScenarios).toHaveBeenCalledTimes(1);
      expect(scenarioService.createScenarios).toHaveBeenCalledWith(
        mockCreateScenariosDto,
        mockTokenUser.id,
      );
    });

    it('should handle empty scenarios array', async () => {
      const emptyDto = { scenarios: [] };
      scenarioService.createScenarios.mockResolvedValue([]);

      const result = await controller.createScenario(mockTokenUser, emptyDto);

      expect(result).toEqual([]);
      expect(scenarioService.createScenarios).toHaveBeenCalledWith(
        emptyDto,
        mockTokenUser.id,
      );
    });
  });

  describe('updateScenario', () => {
    it('should update a scenario by id', async () => {
      const scenarioId = 1;
      scenarioService.updateScenario.mockResolvedValue(true);

      const result = await controller.updateScenario(
        mockTokenUser,
        scenarioId,
        mockUpdateScenarioDto,
      );

      expect(result).toBe(true);

      expect(scenarioService.updateScenario).toHaveBeenCalledTimes(1);
      expect(scenarioService.updateScenario).toHaveBeenCalledWith(
        scenarioId,
        mockUpdateScenarioDto,
        mockTokenUser.id,
      );
    });

    it('should return false when update fails', async () => {
      const scenarioId = 1;
      scenarioService.updateScenario.mockResolvedValue(false);

      const result = await controller.updateScenario(
        mockTokenUser,
        scenarioId,
        mockUpdateScenarioDto,
      );

      expect(result).toBe(false);
    });
  });

  describe('getScenarioSessions', () => {
    it('should return scenario sessions for user with default parameters', async () => {
      const mockSessions = { data: [mockScenarioSessionResponse] };
      scenarioSessionService.getScenarioSessions.mockResolvedValue(
        mockSessions,
      );

      const result = await controller.getScenarioSessions(mockTokenUser);

      expect(result).toEqual(mockSessions);

      expect(scenarioSessionService.getScenarioSessions).toHaveBeenCalledTimes(
        1,
      );
      expect(scenarioSessionService.getScenarioSessions).toHaveBeenCalledWith(
        mockTokenUser.id,
        {
          limit: undefined,
          offset: undefined,
          sortBy: ScenarioSessionSortBy.CREATED_AT,
          order: SortOrder.DESC,
        },
        undefined,
      );
    });

    it('should return scenario sessions for user with custom parameters', async () => {
      const mockSessions = { data: [mockScenarioSessionResponse] };
      const statuses = 'ENDED,ACTIVE';
      const limit = 10;
      const offset = 0;
      const sortBy = ScenarioSessionSortBy.SCORE;
      const order = SortOrder.ASC;

      scenarioSessionService.getScenarioSessions.mockResolvedValue(
        mockSessions,
      );

      const result = await controller.getScenarioSessions(
        mockTokenUser,
        statuses,
        limit,
        offset,
        sortBy,
        order,
      );

      expect(result).toEqual(mockSessions);

      expect(scenarioSessionService.getScenarioSessions).toHaveBeenCalledTimes(
        1,
      );
      expect(scenarioSessionService.getScenarioSessions).toHaveBeenCalledWith(
        mockTokenUser.id,
        {
          limit,
          offset,
          sortBy,
          order,
        },
        statuses,
      );
    });

    it('should return empty sessions array', async () => {
      scenarioSessionService.getScenarioSessions.mockResolvedValue({
        data: [],
      });

      const result = await controller.getScenarioSessions(mockTokenUser);

      expect(result).toEqual({ data: [] });
    });
  });

  describe('getAdminScenarioSessions', () => {
    it('should return admin scenario sessions with default parameters', async () => {
      const mockSessions = { data: [mockScenarioSessionResponse] };
      scenarioSessionService.getAdminScenarioSessions.mockResolvedValue(
        mockSessions,
      );

      const result = await controller.getAdminScenarioSessions();

      expect(result).toEqual(mockSessions);

      expect(
        scenarioSessionService.getAdminScenarioSessions,
      ).toHaveBeenCalledTimes(1);
      expect(
        scenarioSessionService.getAdminScenarioSessions,
      ).toHaveBeenCalledWith({
        limit: undefined,
        offset: undefined,
        sortBy: ScenarioSessionSortBy.CREATED_AT,
        order: SortOrder.DESC,
      });
    });

    it('should return admin scenario sessions with custom parameters', async () => {
      const mockSessions = { data: [mockScenarioSessionResponse] };
      const limit = 20;
      const offset = 10;
      const sortBy = ScenarioSessionSortBy.ENDED_AT;
      const order = SortOrder.ASC;

      scenarioSessionService.getAdminScenarioSessions.mockResolvedValue(
        mockSessions,
      );

      const result = await controller.getAdminScenarioSessions(
        limit,
        offset,
        sortBy,
        order,
      );

      expect(result).toEqual(mockSessions);

      expect(
        scenarioSessionService.getAdminScenarioSessions,
      ).toHaveBeenCalledTimes(1);
      expect(
        scenarioSessionService.getAdminScenarioSessions,
      ).toHaveBeenCalledWith({
        limit,
        offset,
        sortBy,
        order,
      });
    });
  });

  describe('getScenarioSession', () => {
    it('should return a scenario session by id with hasFeedback flag', async () => {
      const sessionId = 'session-123';
      const mockSessionWithFeedback = {
        ...mockScenarioSessionResponse,
        hasFeedback: false,
      };
      scenarioSessionService.getScenarioSession.mockResolvedValue(
        mockSessionWithFeedback,
      );

      const result = await controller.getScenarioSession(
        mockTokenUser,
        sessionId,
      );

      expect(result).toEqual(mockSessionWithFeedback);
      expect(scenarioSessionService.getScenarioSession).toHaveBeenCalledTimes(
        1,
      );
      expect(scenarioSessionService.getScenarioSession).toHaveBeenCalledWith(
        sessionId,
        mockTokenUser.id,
      );
    });
  });

  describe('mapEventsToScenario', () => {
    it('should map events to scenario', async () => {
      const mockResult = [
        {
          scenarioId: 1,
          eventId: 'event1',
          tenantId: 'tenant-123',
          feedbackStatus: false,
          score: undefined,
          emoji: undefined,
          message: undefined,
          branchingStatus: false,
          branchInstruction: undefined,
        },
        {
          scenarioId: 1,
          eventId: 'event2',
          tenantId: 'tenant-123',
          feedbackStatus: false,
          score: undefined,
          emoji: undefined,
          message: undefined,
          branchingStatus: false,
          branchInstruction: undefined,
        },
        {
          scenarioId: 1,
          eventId: 'event3',
          tenantId: 'tenant-123',
          feedbackStatus: false,
          score: undefined,
          emoji: undefined,
          message: undefined,
          branchingStatus: false,
          branchInstruction: undefined,
        },
      ] as any;
      scenarioService.mapEventsToScenario.mockResolvedValue(mockResult);

      const result = await controller.mapEventsToScenario(
        mockCreateScenarioEventsDto,
      );

      expect(result).toEqual(mockResult);
      expect(scenarioService.mapEventsToScenario).toHaveBeenCalledTimes(1);
      expect(scenarioService.mapEventsToScenario).toHaveBeenCalledWith(
        mockCreateScenarioEventsDto,
      );
    });

    it('should map events to scenario with event-specific feedback and branching data', async () => {
      const mockCreateDtoWithEventSpecificData = {
        scenarioId: 1,
        events: [
          {
            id: 'event1',
            feedbackStatus: true,
            score: 85,
            emoji: '👍',
            message: 'Great job on event 1!',
            branchingStatus: true,
            branchInstruction: 'Continue with next step',
          },
          {
            id: 'event2',
            feedbackStatus: false,
            branchingStatus: false,
          },
          {
            id: 'event3',
            feedbackStatus: true,
            score: 90,
            emoji: '🎉',
            message: 'Excellent work!',
            branchingStatus: true,
            branchInstruction: 'Move to advanced level',
          },
        ],
      };

      const mockResult = [
        {
          scenarioId: 1,
          eventId: 'event1',
          tenantId: 'tenant-123',
          feedbackStatus: true,
          score: 85,
          emoji: '👍',
          message: 'Great job on event 1!',
          branchingStatus: true,
          branchInstruction: 'Continue with next step',
        },
        {
          scenarioId: 1,
          eventId: 'event2',
          tenantId: 'tenant-123',
          feedbackStatus: false,
          score: undefined,
          emoji: undefined,
          message: undefined,
          branchingStatus: false,
          branchInstruction: undefined,
        },
        {
          scenarioId: 1,
          eventId: 'event3',
          tenantId: 'tenant-123',
          feedbackStatus: true,
          score: 90,
          emoji: '🎉',
          message: 'Excellent work!',
          branchingStatus: true,
          branchInstruction: 'Move to advanced level',
        },
      ] as any;

      scenarioService.mapEventsToScenario.mockResolvedValue(mockResult);

      const result = await controller.mapEventsToScenario(
        mockCreateDtoWithEventSpecificData,
      );

      expect(result).toEqual(mockResult);
      expect(scenarioService.mapEventsToScenario).toHaveBeenCalledTimes(1);
      expect(scenarioService.mapEventsToScenario).toHaveBeenCalledWith(
        mockCreateDtoWithEventSpecificData,
      );
    });
  });

  describe('deleteScenarioEvents', () => {
    it('should delete scenario events and return true when rows affected > 0', async () => {
      scenarioService.deleteScenarioEvents.mockResolvedValue(2);

      const result = await controller.deleteScenarioEvents(
        mockDeleteScenarioEventsDto,
      );

      expect(result).toBe(true);
      expect(scenarioService.deleteScenarioEvents).toHaveBeenCalledTimes(1);
      expect(scenarioService.deleteScenarioEvents).toHaveBeenCalledWith(
        mockDeleteScenarioEventsDto,
      );
    });

    it('should delete scenario events and return false when no rows affected', async () => {
      scenarioService.deleteScenarioEvents.mockResolvedValue(0);

      const result = await controller.deleteScenarioEvents(
        mockDeleteScenarioEventsDto,
      );

      expect(result).toBe(false);
      expect(scenarioService.deleteScenarioEvents).toHaveBeenCalledTimes(1);
      expect(scenarioService.deleteScenarioEvents).toHaveBeenCalledWith(
        mockDeleteScenarioEventsDto,
      );
    });

    it('should delete scenario events and return false when null returned', async () => {
      scenarioService.deleteScenarioEvents.mockResolvedValue(null);

      const result = await controller.deleteScenarioEvents(
        mockDeleteScenarioEventsDto,
      );

      expect(result).toBe(false);
      expect(scenarioService.deleteScenarioEvents).toHaveBeenCalledTimes(1);
      expect(scenarioService.deleteScenarioEvents).toHaveBeenCalledWith(
        mockDeleteScenarioEventsDto,
      );
    });
  });

  describe('startScenarioSession', () => {
    it('should start a scenario session', async () => {
      const mockResult = {
        scenarioSession: {
          id: 'session-123',
          roomId: 'room-123',
          scenarioId: 1,
          counselorId: 123,
          status: ScenarioSessionStatus.ACTIVE,
          createdAt: new Date(),
          updatedAt: new Date(),
          tenantId: 'tenant-123',
        },
        accessToken: {
          token: 'mock-jwt-token',
          roomName: 'room-123',
          serverUrl: 'ws://localhost:7880',
        },
      };
      scenarioSessionService.startScenarioSession.mockResolvedValue(mockResult);

      const result = await controller.startScenarioSession(
        mockTokenUser,
        mockStartScenarioSessionDto,
      );

      expect(result).toEqual(mockResult);
      expect(scenarioSessionService.startScenarioSession).toHaveBeenCalledTimes(
        1,
      );
      expect(scenarioSessionService.startScenarioSession).toHaveBeenCalledWith(
        mockTokenUser.id,
        mockStartScenarioSessionDto,
      );
    });
  });

  describe('endScenarioSession', () => {
    it('should end a scenario session', async () => {
      const scenarioSessionId = 'session-123';
      const mockResult = { message: 'Scenario session ended successfully' };
      scenarioSessionService.endScenarioSession.mockResolvedValue(mockResult);

      const result = await controller.endScenarioSession(
        mockTokenUser,
        scenarioSessionId,
      );

      expect(result).toEqual(mockResult);
      expect(scenarioSessionService.endScenarioSession).toHaveBeenCalledTimes(
        1,
      );
      expect(scenarioSessionService.endScenarioSession).toHaveBeenCalledWith(
        scenarioSessionId,
        mockTokenUser.id,
      );
    });
  });

  describe('addFeedbackToScenarioSession', () => {
    it('should add feedback to a scenario session', async () => {
      const scenarioSessionId = 'session-123';
      const mockResult = {
        id: 'feedback-123',
        scenarioSessionId,
        rating: 5,
        feedback: 'Great session',
        tenantId: 'tenant-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      scenarioSessionService.addFeedbackToScenarioSession.mockResolvedValue(
        mockResult,
      );

      const result = await controller.addFeedbackToScenarioSession(
        mockTokenUser,
        scenarioSessionId,
        mockAddFeedbackDto,
      );

      expect(result).toEqual(mockResult);
      expect(
        scenarioSessionService.addFeedbackToScenarioSession,
      ).toHaveBeenCalledTimes(1);
      expect(
        scenarioSessionService.addFeedbackToScenarioSession,
      ).toHaveBeenCalledWith(
        scenarioSessionId,
        mockTokenUser.id,
        mockAddFeedbackDto,
      );
    });
  });

  describe('getMessagesByScenarioSessionId', () => {
    it('should return messages for a scenario session with default parameters', async () => {
      const scenarioSessionId = 'session-123';
      const mockMessages = {
        messages: [
          {
            id: 1,
            scenarioSessionId,
            senderId: 123,
            messageType: ScenarioSessionMessageType.TEXT,
            content: 'Hello',
            metadata: {},
            startSeconds: 0,
            endSeconds: 10,
            createdAt: new Date(),
            updatedAt: new Date(),
            tenantId: 'tenant-123',
          },
        ],
      };
      scenarioSessionService.getMessagesByScenarioSessionId.mockResolvedValue(
        mockMessages,
      );

      const result =
        await controller.getMessagesByScenarioSessionId(scenarioSessionId);

      expect(result).toEqual(mockMessages);
      expect(
        scenarioSessionService.getMessagesByScenarioSessionId,
      ).toHaveBeenCalledTimes(1);
      expect(
        scenarioSessionService.getMessagesByScenarioSessionId,
      ).toHaveBeenCalledWith(scenarioSessionId, {
        limit: undefined,
        offset: undefined,
        sortBy: undefined,
        order: SortOrder.ASC,
      });
    });

    it('should return messages for a scenario session with custom parameters', async () => {
      const scenarioSessionId = 'session-123';
      const limit = 50;
      const offset = 10;
      const sortBy = 'createdAt';
      const order = SortOrder.DESC;
      const mockMessages = {
        messages: [
          {
            id: 1,
            scenarioSessionId,
            senderId: 123,
            messageType: ScenarioSessionMessageType.TEXT,
            content: 'Hello',
            metadata: {},
            startSeconds: 0,
            endSeconds: 10,
            createdAt: new Date(),
            updatedAt: new Date(),
            tenantId: 'tenant-123',
          },
        ],
      };
      scenarioSessionService.getMessagesByScenarioSessionId.mockResolvedValue(
        mockMessages,
      );

      const result = await controller.getMessagesByScenarioSessionId(
        scenarioSessionId,
        limit,
        offset,
        sortBy,
        order,
      );

      expect(result).toEqual(mockMessages);
      expect(
        scenarioSessionService.getMessagesByScenarioSessionId,
      ).toHaveBeenCalledTimes(1);
      expect(
        scenarioSessionService.getMessagesByScenarioSessionId,
      ).toHaveBeenCalledWith(scenarioSessionId, {
        limit,
        offset,
        sortBy,
        order,
      });
    });
  });

  describe('getScenarioVoices', () => {
    it('should return all scenario voices with pagination', async () => {
      const mockVoices = [
        {
          id: 'voice-1',
          name: 'Voice 1',
          voiceId: 'openai-voice-1',
          provider: 'openai',
          config: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'voice-2',
          name: 'Voice 2',
          voiceId: 'openai-voice-2',
          provider: 'openai',
          config: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      scenarioService.getScenarioVoices.mockResolvedValue(mockVoices);

      const result = await controller.getScenarioVoices(
        10,
        0,
        'name' as any,
        'ASC' as any,
      );

      expect(result).toEqual(mockVoices);
      expect(scenarioService.getScenarioVoices).toHaveBeenCalledWith({
        limit: 10,
        offset: 0,
        sortBy: 'name',
        order: 'ASC',
      });
    });
  });

  describe('createScenarioVoice', () => {
    it('should create and return multiple scenario voices', async () => {
      const createDto = {
        voices: [
          {
            name: 'New Voice 1',
            provider: 'openai',
            config: { model: 'gpt-4', voiceId: 'voice-1' },
          },
          {
            name: 'New Voice 2',
            provider: 'deepgram',
            config: { voiceId: 'voice-2' },
          },
        ],
      };
      const createdVoices = [
        {
          id: 'new-voice-123',
          name: 'New Voice 1',
          provider: 'openai',
          config: { model: 'gpt-4', voiceId: 'voice-1' },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'new-voice-456',
          name: 'New Voice 2',
          provider: 'deepgram',
          config: { voiceId: 'voice-2' },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      scenarioService.createScenarioVoices.mockResolvedValue(
        createdVoices as any,
      );

      const result = await controller.createScenarioVoices(createDto);

      expect(result).toEqual(createdVoices);
      expect(scenarioService.createScenarioVoices).toHaveBeenCalledWith(
        createDto,
      );
    });

    it('should handle empty voices array', async () => {
      const emptyDto = { voices: [] };
      scenarioService.createScenarioVoices.mockResolvedValue([]);

      const result = await controller.createScenarioVoices(emptyDto);

      expect(result).toEqual([]);
      expect(scenarioService.createScenarioVoices).toHaveBeenCalledWith(
        emptyDto,
      );
    });

    it('should handle single voice in array', async () => {
      const singleVoiceDto = {
        voices: [
          {
            name: 'Single Voice',
            provider: 'openai',
            config: { model: 'gpt-4', voiceId: 'voice-single' },
          },
        ],
      };
      const createdVoice = [
        {
          id: 'single-voice-123',
          name: 'Single Voice',
          provider: 'openai',
          config: { model: 'gpt-4', voiceId: 'voice-single' },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      scenarioService.createScenarioVoices.mockResolvedValue(
        createdVoice as any,
      );

      const result = await controller.createScenarioVoices(singleVoiceDto);

      expect(result).toEqual(createdVoice);
      expect(scenarioService.createScenarioVoices).toHaveBeenCalledWith(
        singleVoiceDto,
      );
    });
  });

  describe('updateScenarioVoice', () => {
    it('should update scenario voice and return result', async () => {
      const voiceId = 'voice-123';
      const updateDto = {
        name: 'Updated Voice',
        voiceId: 'openai-updated-voice',
      };

      scenarioService.updateScenarioVoice.mockResolvedValue(true);

      const result = await controller.updateScenarioVoice(voiceId, updateDto);

      expect(result).toBe(true);
      expect(scenarioService.updateScenarioVoice).toHaveBeenCalledWith(
        voiceId,
        updateDto,
      );
    });
  });

  describe('getScenarioEvents', () => {
    it('should return scenario events with pagination', async () => {
      const scenarioId = 1;
      const limit = 10;
      const offset = 0;
      const mockEvents = {
        data: [
          {
            eventId: 'event-1',
            name: 'Event 1',
            feedbackStatus: true,
            emoji: '👍',
            message: 'Great job!',
            score: 85,
            branchingStatus: true,
            branchInstruction: 'Continue with next step',
          },
        ],
        count: 1,
      };

      scenarioService.getScenarioEvents.mockResolvedValue(mockEvents);

      const result = await controller.getScenarioEvents(
        scenarioId,
        limit,
        offset,
      );

      expect(result).toEqual(mockEvents);
      expect(scenarioService.getScenarioEvents).toHaveBeenCalledWith(
        scenarioId,
        {
          limit,
          offset,
          sortBy: 'createdAt',
          order: 'DESC',
        },
      );
    });

    it('should return scenario events without pagination', async () => {
      const scenarioId = 1;

      const mockEvents = {
        data: [
          {
            eventId: 'event-1',
            name: 'Event 1',
            feedbackStatus: false,
            emoji: undefined,
            message: undefined,
            score: undefined,
            branchingStatus: false,
            branchInstruction: undefined,
          },
        ],
        count: 1,
      };

      scenarioService.getScenarioEvents.mockResolvedValue(mockEvents);

      const result = await controller.getScenarioEvents(scenarioId);

      expect(result).toEqual(mockEvents);
      expect(scenarioService.getScenarioEvents).toHaveBeenCalledWith(
        scenarioId,
        {
          limit: undefined,
          offset: undefined,
          sortBy: 'createdAt',
          order: 'DESC',
        },
      );
    });

    it('should handle empty events', async () => {
      const scenarioId = 1;
      const mockEvents = { data: [], count: 0 };

      scenarioService.getScenarioEvents.mockResolvedValue(mockEvents);

      const result = await controller.getScenarioEvents(scenarioId);

      expect(result).toEqual(mockEvents);
    });

    it('should handle service errors', async () => {
      const scenarioId = 1;
      const error = new Error('Service error');
      scenarioService.getScenarioEvents.mockRejectedValue(error);

      await expect(controller.getScenarioEvents(scenarioId)).rejects.toThrow(
        'Service error',
      );
    });
  });

  describe('previewScenario', () => {
    it('should preview a scenario', async () => {
      const previewDto = {
        scenarioId: 1,
      };
      const mockUser = {
        id: 123,
        tenantId: 1,
        role: 'ADMIN',
      };
      const expectedResponse = {
        scenarioSession: { id: 'preview-session-123' },
        accessToken: 'mock-token',
      };

      scenarioSessionService.previewScenario.mockResolvedValue(
        expectedResponse as any,
      );

      const result = await controller.previewScenario(
        mockUser as any,
        previewDto as any,
      );

      expect(result).toEqual(expectedResponse);
      expect(scenarioSessionService.previewScenario).toHaveBeenCalledWith(
        previewDto,
        mockUser.id,
      );
    });
  });

  describe('getAdminScenario', () => {
    it('should return admin scenario by id', async () => {
      const scenarioId = 1;
      const mockAdminScenario = {
        id: 1,
        title: 'Admin Scenario',
        scenario: 'Admin scenario content',
        description: 'Admin description',
        coverImageUrl: 'https://example.com/admin-cover.jpg',
        status: ScenarioStatus.ACTIVE,
        prompt: 'Admin prompt',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        tenantId: 'tenant-123',
        createdBy: 1,
      };

      scenarioService.getAdminScenario.mockResolvedValue(mockAdminScenario);

      const result = await controller.getAdminScenario(scenarioId);

      expect(result).toEqual(mockAdminScenario);
      expect(scenarioService.getAdminScenario).toHaveBeenCalledWith(scenarioId);
    });

    it('should handle scenario not found', async () => {
      const scenarioId = 999;
      const error = new Error('Scenario not found');
      scenarioService.getAdminScenario.mockRejectedValue(error);

      await expect(controller.getAdminScenario(scenarioId)).rejects.toThrow(
        'Scenario not found',
      );
    });
  });

  describe('deleteAdminScenario', () => {
    it('should delete admin scenario and return true', async () => {
      const scenarioId = 1;
      scenarioService.deleteAdminScenario.mockResolvedValue(true);

      const result = await controller.deleteAdminScenario(scenarioId);

      expect(result).toBe(true);
      expect(scenarioService.deleteAdminScenario).toHaveBeenCalledWith(
        scenarioId,
      );
    });

    it('should return false when deletion fails', async () => {
      const scenarioId = 1;
      scenarioService.deleteAdminScenario.mockResolvedValue(false);

      const result = await controller.deleteAdminScenario(scenarioId);

      expect(result).toBe(false);
    });

    it('should handle scenario not found during deletion', async () => {
      const scenarioId = 999;
      const error = new Error('Scenario not found');
      scenarioService.deleteAdminScenario.mockRejectedValue(error);

      await expect(controller.deleteAdminScenario(scenarioId)).rejects.toThrow(
        'Scenario not found',
      );
    });
  });

  describe('getPresignedUrlForScenarioCoverImage', () => {
    it('should return presigned URL for scenario cover image', async () => {
      const requestDto = {
        fileName: 'test-image.jpg',
        fileSize: 1024 * 1024, // 1 MB
        contentType: 'image/jpeg' as any,
      };
      const mockResponse = {
        presignedUrl: 'https://presigned-url.com',
        coverImageUrl:
          'https://test-bucket.s3.us-east-1.amazonaws.com/scenario-cover-images/1234567890-test-image.jpg',
      };

      scenarioService.getPresignedUrlForScenarioCoverImage.mockResolvedValue(
        mockResponse,
      );

      const result =
        await controller.getPresignedUrlForScenarioCoverImage(requestDto);

      expect(result).toEqual(mockResponse);
      expect(
        scenarioService.getPresignedUrlForScenarioCoverImage,
      ).toHaveBeenCalledWith(requestDto);
    });

    it('should handle invalid file type', async () => {
      const requestDto = {
        fileName: 'test-file.txt',
        fileSize: 1024,
        contentType: 'text/plain' as any,
      };
      const error = new Error('Invalid file type');
      scenarioService.getPresignedUrlForScenarioCoverImage.mockRejectedValue(
        error,
      );

      await expect(
        controller.getPresignedUrlForScenarioCoverImage(requestDto),
      ).rejects.toThrow('Invalid file type');
    });

    it('should handle file size too large', async () => {
      const requestDto = {
        fileName: 'large-image.jpg',
        fileSize: 3 * 1024 * 1024, // 3 MB
        contentType: 'image/jpeg' as any,
      };
      const error = new Error('File size too large');
      scenarioService.getPresignedUrlForScenarioCoverImage.mockRejectedValue(
        error,
      );

      await expect(
        controller.getPresignedUrlForScenarioCoverImage(requestDto),
      ).rejects.toThrow('File size too large');
    });
  });
  describe('endPreviewScenario', () => {
    it('should end a preview scenario', async () => {
      const roomName = 'preview-test-session-123';
      const expectedResponse = { message: 'Preview ended successfully' };

      scenarioSessionService.endPreviewScenario.mockResolvedValue(
        expectedResponse as any,
      );

      const result = await controller.endPreviewScenario(roomName);

      expect(result).toEqual(expectedResponse);
      expect(scenarioSessionService.endPreviewScenario).toHaveBeenCalledWith(
        roomName,
      );
    });
  });

  describe('deleteCoverImage', () => {
    it('should call scenarioService.deleteCoverImage with the correct DTO', async () => {
      const deleteCoverImageDto: DeleteCoverImageDto = {
        coverImageUrl:
          'https://example-bucket.s3.ap-south-1.amazonaws.com/uploads/test.jpg',
      };

      (scenarioService.deleteCoverImage as jest.Mock).mockResolvedValue(true);

      const result = await controller.deleteCoverImage(deleteCoverImageDto);

      expect(scenarioService.deleteCoverImage).toHaveBeenCalledWith(
        deleteCoverImageDto,
      );
      expect(result).toBe(true);
    });

    it('should handle errors gracefully if scenarioService throws', async () => {
      const deleteCoverImageDto: DeleteCoverImageDto = {
        coverImageUrl:
          'https://example-bucket.s3.ap-south-1.amazonaws.com/uploads/error.jpg',
      };

      (scenarioService.deleteCoverImage as jest.Mock).mockRejectedValue(
        new Error('Failed to delete'),
      );

      await expect(
        controller.deleteCoverImage(deleteCoverImageDto),
      ).rejects.toThrow('Failed to delete');
    });
  });
  describe('getPresignedUrlForScenarioCoverVideo', () => {
    it('should return presigned URL for scenario cover video', async () => {
      const requestDto: ScenarioVideoUploadRequestDto = {
        fileName: 'test-video.mp4',
        fileSize: 5 * 1024 * 1024, // 5 MB
        contentType: ScenarioVideoUploadContentType.MP4,
        duration: 8,
      };
      const expectedResponse = {
        presignedUrl: 'https://presigned-url.com',
        coverVideoUrl:
          'https://test-bucket.s3.us-east-1.amazonaws.com/scenario-cover-videos/1234567890-test-video.mp4',
      };

      scenarioService.getPresignedUrlForScenarioCoverVideo.mockResolvedValue(
        expectedResponse,
      );

      const result =
        await controller.getPresignedUrlForScenarioCoverVideo(requestDto);

      expect(result).toEqual(expectedResponse);
      expect(
        scenarioService.getPresignedUrlForScenarioCoverVideo,
      ).toHaveBeenCalledWith(requestDto);
    });

    it('should handle invalid video file type', async () => {
      const requestDto: ScenarioVideoUploadRequestDto = {
        fileName: 'test-video.avi',
        fileSize: 1024 * 1024,
        contentType: 'video/avi' as any,
        duration: 5,
      };
      const error = new Error('Invalid file type');
      scenarioService.getPresignedUrlForScenarioCoverVideo.mockRejectedValue(
        error,
      );

      await expect(
        controller.getPresignedUrlForScenarioCoverVideo(requestDto),
      ).rejects.toThrow('Invalid file type');
    });

    it('should handle video file size too large', async () => {
      const requestDto: ScenarioVideoUploadRequestDto = {
        fileName: 'large-video.mp4',
        fileSize: 100 * 1024 * 1024, // 100 MB
        contentType: ScenarioVideoUploadContentType.MP4,
        duration: 120,
      };
      const error = new Error('File size too large');
      scenarioService.getPresignedUrlForScenarioCoverVideo.mockRejectedValue(
        error,
      );

      await expect(
        controller.getPresignedUrlForScenarioCoverVideo(requestDto),
      ).rejects.toThrow('File size too large');
    });
  });

  describe('deleteCoverVideo', () => {
    it('should call scenarioService.deleteCoverVideo with the correct DTO', async () => {
      const deleteCoverVideoDto: DeleteCoverVideoDto = {
        coverVideoUrl:
          'https://example-bucket.s3.ap-south-1.amazonaws.com/uploads/test-video.mp4',
      };

      (scenarioService.deleteCoverVideo as jest.Mock).mockResolvedValue(true);

      const result = await controller.deleteCoverVideo(deleteCoverVideoDto);

      expect(scenarioService.deleteCoverVideo).toHaveBeenCalledWith(
        deleteCoverVideoDto,
      );
      expect(result).toBe(true);
    });

    it('should handle errors gracefully if scenarioService throws', async () => {
      const deleteCoverVideoDto: DeleteCoverVideoDto = {
        coverVideoUrl:
          'https://example-bucket.s3.ap-south-1.amazonaws.com/uploads/error-video.mp4',
      };

      (scenarioService.deleteCoverVideo as jest.Mock).mockRejectedValue(
        new Error('Failed to delete video'),
      );

      await expect(
        controller.deleteCoverVideo(deleteCoverVideoDto),
      ).rejects.toThrow('Failed to delete video');
    });
  });
});
