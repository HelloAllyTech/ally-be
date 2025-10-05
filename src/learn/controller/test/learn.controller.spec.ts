import { Test, TestingModule } from '@nestjs/testing';
import { LearnController } from '../learn.controller';
import { ScenarioService } from '../../service/scenario.service';
import { ScenarioSessionService } from '../../service/scenario-session.service';
import { UserRole } from 'src/common/constants/user.constants';
import { SortOrder } from 'src/chat/dto/call-log.request.dto';
import { ScenarioSessionSortBy } from '../../enum/scenario-session-sort-by.enum';
import { TokenUser } from 'src/auth/type/auth.types';
import { ScenarioStatus } from '../../enum/scenario.status.enum';
import { ScenarioSessionStatus } from '../../enum/scenario-session-status.enum';
import { ScenarioSessionMessageType } from '../../enum/scenario-session-message.type.enum';
import { UserInfo } from 'src/chat/dto/call-log.response.dto';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from 'src/authorization/service/permissions.service';

describe('LearnController', () => {
  let controller: LearnController;
  let scenarioService: jest.Mocked<ScenarioService>;
  let scenarioSessionService: jest.Mocked<ScenarioSessionService>;

  const mockTokenUser: TokenUser = {
    id: 123,
    username: 'test@example.com',
    role: UserRole.LEARNER,
    tenantId: 'tenant-123',
  };

  const mockScenarioResponse = {
    id: 1,
    title: 'Test Scenario',
    scenario: 'Test Scenario Content',
    description: 'Test Description',
    coverImageUrl: 'https://example.com/cover.jpg',
    status: ScenarioStatus.ACTIVE,
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
        status: 'ACTIVE',
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
    status: 'ACTIVE',
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
    eventIds: ['event1', 'event2', 'event3'],
  };

  const mockDeleteScenarioEventsDto = {
    scenarioId: 1,
    eventIds: ['event1', 'event2'],
  };

  beforeEach(async () => {
    const mockScenarioService = {
      getScenarios: jest.fn(),
      getScenario: jest.fn(),
      createScenarios: jest.fn(),
      updateScenario: jest.fn(),
    };

    const mockScenarioSessionService = {
      getScenarioSessions: jest.fn(),
      getAdminScenarioSessions: jest.fn(),
      getScenarioSession: jest.fn(),
      mapEventsToScenario: jest.fn(),
      deleteScenarioEvents: jest.fn(),
      startScenarioSession: jest.fn(),
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

  describe('getScenarios', () => {
    it('should return all scenarios', async () => {
      scenarioService.getScenarios.mockResolvedValue(mockScenarios);

      const result = await controller.getScenarios();

      expect(result).toEqual(mockScenarios);

      expect(scenarioService.getScenarios).toHaveBeenCalledTimes(1);
      expect(scenarioService.getScenarios).toHaveBeenCalledWith();
    });
  });

  describe('getScenario', () => {
    it('should return a scenario by id', async () => {
      const scenarioId = 1;
      scenarioService.getScenario.mockResolvedValue(mockScenarioResponse);

      const result = await controller.getScenario(scenarioId);

      expect(result).toEqual(mockScenarioResponse);

      expect(scenarioService.getScenario).toHaveBeenCalledTimes(1);
      expect(scenarioService.getScenario).toHaveBeenCalledWith(scenarioId);
    });
  });

  describe('createScenario', () => {
    it('should create multiple scenarios', async () => {
      scenarioService.createScenarios.mockResolvedValue(mockScenarios as any);

      const result = await controller.createScenario(mockCreateScenariosDto);

      expect(result).toEqual(mockScenarios);

      expect(scenarioService.createScenarios).toHaveBeenCalledTimes(1);
      expect(scenarioService.createScenarios).toHaveBeenCalledWith(
        mockCreateScenariosDto,
      );
    });
  });

  describe('updateScenario', () => {
    it('should update a scenario by id', async () => {
      const scenarioId = 1;
      scenarioService.updateScenario.mockResolvedValue(true);

      const result = await controller.updateScenario(
        scenarioId,
        mockUpdateScenarioDto,
      );

      expect(result).toBe(true);

      expect(scenarioService.updateScenario).toHaveBeenCalledTimes(1);
      expect(scenarioService.updateScenario).toHaveBeenCalledWith(
        scenarioId,
        mockUpdateScenarioDto,
      );
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
        },
        {
          scenarioId: 1,
          eventId: 'event2',
          tenantId: 'tenant-123',
        },
        {
          scenarioId: 1,
          eventId: 'event3',
          tenantId: 'tenant-123',
        },
      ];
      scenarioSessionService.mapEventsToScenario.mockResolvedValue(mockResult);

      const result = await controller.mapEventsToScenario(
        mockCreateScenarioEventsDto,
      );

      expect(result).toEqual(mockResult);
      expect(scenarioSessionService.mapEventsToScenario).toHaveBeenCalledTimes(
        1,
      );
      expect(scenarioSessionService.mapEventsToScenario).toHaveBeenCalledWith(
        mockCreateScenarioEventsDto,
      );
    });
  });

  describe('deleteScenarioEvents', () => {
    it('should delete scenario events and return true when rows affected > 0', async () => {
      scenarioSessionService.deleteScenarioEvents.mockResolvedValue(2);

      const result = await controller.deleteScenarioEvents(
        mockDeleteScenarioEventsDto,
      );

      expect(result).toBe(true);
      expect(scenarioSessionService.deleteScenarioEvents).toHaveBeenCalledTimes(
        1,
      );
      expect(scenarioSessionService.deleteScenarioEvents).toHaveBeenCalledWith(
        mockDeleteScenarioEventsDto,
      );
    });

    it('should delete scenario events and return false when no rows affected', async () => {
      scenarioSessionService.deleteScenarioEvents.mockResolvedValue(0);

      const result = await controller.deleteScenarioEvents(
        mockDeleteScenarioEventsDto,
      );

      expect(result).toBe(false);
      expect(scenarioSessionService.deleteScenarioEvents).toHaveBeenCalledTimes(
        1,
      );
      expect(scenarioSessionService.deleteScenarioEvents).toHaveBeenCalledWith(
        mockDeleteScenarioEventsDto,
      );
    });

    it('should delete scenario events and return false when null returned', async () => {
      scenarioSessionService.deleteScenarioEvents.mockResolvedValue(null);

      const result = await controller.deleteScenarioEvents(
        mockDeleteScenarioEventsDto,
      );

      expect(result).toBe(false);
      expect(scenarioSessionService.deleteScenarioEvents).toHaveBeenCalledTimes(
        1,
      );
      expect(scenarioSessionService.deleteScenarioEvents).toHaveBeenCalledWith(
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
});
