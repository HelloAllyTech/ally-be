import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { ScenarioSessionRepository } from '../scenario-session.repository';
import { ScenarioSessions } from '../../entity/scenario-sessions.entity';
import { Scenarios } from '../../entity/scenarios.entity';
import { User } from 'src/common/entities/user.entity';
import { ScenarioSessionDetails } from '../../entity/scenario-session-details.entity';
import { ScenarioSessionEvents } from '../../entity/scenario-session-events.entity';
import { SessionEvents } from 'src/session-event/entity/session-events.entity';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { StartScenarioSessionRequestDto } from '../../dto/start-scenario-session-request.dto';
import { Pagination } from 'src/common/type/common.type';
import { ScenarioSessionStatus } from '../../enum/scenario-session-status.enum';
import { ScenarioStatus } from '../../enum/scenario.status.enum';
import { UserRole, UserStatus } from 'src/common/constants/user.constants';
import { SessionEventVisibilityType } from 'src/session-event/enum/session-event-visibility-type.enum';
import { v4 as uuidv4 } from 'uuid';

// Mock static classes
jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getTenantId: jest.fn(),
    getUserId: jest.fn(),
    getExecutionId: jest.fn(),
  },
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(),
}));

describe('ScenarioSessionRepository', () => {
  let repository: ScenarioSessionRepository;
  let mockEntityManager: any;
  let mockQueryBuilder: jest.Mocked<SelectQueryBuilder<ScenarioSessions>>;

  const mockTenantId = 'tenant-123';
  const mockCounselorId = 123;
  const mockScenarioSessionId = 'session-123';
  const mockScenarioId = 1;
  const mockUuid = 'uuid-123';

  const mockUuidV4 = uuidv4 as jest.Mock;

  const mockScenarioSession: ScenarioSessions = {
    id: mockScenarioSessionId,
    roomId: `ss_${mockUuid}`,
    scenarioId: mockScenarioId,
    counselorId: mockCounselorId,
    status: ScenarioSessionStatus.ACTIVE,
    startedAt: new Date('2024-01-01T10:00:00Z'),
    endedAt: undefined,
    score: undefined,
    metadata: { sessionName: 'SS-1-2024-01-01' },
    tenantId: mockTenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ScenarioSessions;

  const mockScenario: Scenarios = {
    id: mockScenarioId,
    title: 'Test Scenario',
    scenario: 'Test scenario content',
    description: 'Test scenario description',
    coverImageUrl: 'https://example.com/image.jpg',
    status: ScenarioStatus.ACTIVE,
    prompt: 'Test prompt',
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Scenarios;

  const mockUser: User = {
    id: mockCounselorId,
    email: 'counselor@example.com',
    name: 'Test Counselor',
    role: UserRole.COUNSELOR,
    status: UserStatus.ACTIVE,
    username: 'testcounselor',
    metadata: {},
    phone: '+1234567890',
    externalId: 'ext-123',
    tenantId: mockTenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;

  const mockPagination: Pagination = {
    limit: 10,
    offset: 0,
    sortBy: 'createdAt',
    order: 'DESC',
  };

  beforeEach(async () => {
    // Create mock query builder
    mockQueryBuilder = {
      leftJoinAndMapOne: jest.fn().mockReturnThis(),
      leftJoinAndMapMany: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
      getOne: jest.fn(),
      getRawOne: jest.fn(),
      withDeleted: jest.fn().mockReturnThis(),
    } as any;

    mockEntityManager = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    const mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue(mockEntityManager),
    };

    // Setup ExecutionManager mocks
    (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
    (ExecutionManager.getUserId as jest.Mock).mockReturnValue(mockCounselorId);
    (ExecutionManager.getExecutionId as jest.Mock).mockReturnValue('exec-123');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioSessionRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<ScenarioSessionRepository>(
      ScenarioSessionRepository,
    );

    // Mock repository methods
    jest
      .spyOn(repository, 'createQueryBuilder')
      .mockReturnValue(mockQueryBuilder);
    jest
      .spyOn(repository, 'create')
      .mockImplementation((entity) => entity as ScenarioSessions);
    jest
      .spyOn(repository, 'save')
      .mockImplementation(async (entity) => entity as ScenarioSessions);
    jest
      .spyOn(repository, 'query')
      .mockImplementation(async () => [{ last_value: 1 }]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getScenarioSessions', () => {
    it('should return scenario sessions with default parameters', async () => {
      const mockSessions = [mockScenarioSession];
      mockQueryBuilder.getMany.mockResolvedValue(mockSessions);

      const result = await repository.getScenarioSessions(
        mockCounselorId,
        mockPagination,
      );

      expect(result).toEqual(mockSessions);
      expect(repository.createQueryBuilder).toHaveBeenCalledWith(
        'scenarioSession',
      );
      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'scenarioSession.scenario',
        Scenarios,
        'scenario',
        'scenario.id = scenarioSession.scenarioId',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'scenarioSession.tenantId = :tenantId',
        { tenantId: mockTenantId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenarioSession.counselorId = :counselorId',
        { counselorId: mockCounselorId },
      );
    });

    it('should apply status filters when provided', async () => {
      const mockSessions = [mockScenarioSession];
      const statuses = 'ACTIVE,ENDED';
      mockQueryBuilder.getMany.mockResolvedValue(mockSessions);

      const result = await repository.getScenarioSessions(
        mockCounselorId,
        mockPagination,
        statuses,
      );

      expect(result).toEqual(mockSessions);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenarioSession.status IN (:...status )',
        { status: ['ACTIVE', 'ENDED'] },
      );
    });

    it('should apply pagination when limit is provided', async () => {
      const mockSessions = [mockScenarioSession];
      mockQueryBuilder.getMany.mockResolvedValue(mockSessions);

      await repository.getScenarioSessions(mockCounselorId, mockPagination);

      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(mockPagination.limit);
    });

    it('should apply pagination when offset is provided', async () => {
      const mockSessions = [mockScenarioSession];
      const paginationWithOffset = { ...mockPagination, offset: 20 };
      mockQueryBuilder.getMany.mockResolvedValue(mockSessions);

      await repository.getScenarioSessions(
        mockCounselorId,
        paginationWithOffset,
      );

      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(
        paginationWithOffset.offset,
      );
    });

    it('should apply sorting when sortBy and order are provided', async () => {
      const mockSessions = [mockScenarioSession];
      mockQueryBuilder.getMany.mockResolvedValue(mockSessions);

      await repository.getScenarioSessions(mockCounselorId, mockPagination);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        `"scenarioSession"."${mockPagination.sortBy}"`,
        mockPagination.order,
      );
    });

    it('should handle empty status filters', async () => {
      const mockSessions = [mockScenarioSession];
      const statuses = '';
      mockQueryBuilder.getMany.mockResolvedValue(mockSessions);

      const result = await repository.getScenarioSessions(
        mockCounselorId,
        mockPagination,
        statuses,
      );

      expect(result).toEqual(mockSessions);
      // Should not call andWhere for status when empty
      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        'scenarioSession.status IN (:...status )',
        expect.any(Object),
      );
    });

    it('should handle status filters with empty values', async () => {
      const mockSessions = [mockScenarioSession];
      const statuses = 'ACTIVE, , ENDED, ';
      mockQueryBuilder.getMany.mockResolvedValue(mockSessions);

      const result = await repository.getScenarioSessions(
        mockCounselorId,
        mockPagination,
        statuses,
      );

      expect(result).toEqual(mockSessions);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenarioSession.status IN (:...status )',
        { status: ['ACTIVE', 'ENDED'] },
      );
    });

    it('should handle pagination without limit', async () => {
      const mockSessions = [mockScenarioSession];
      const paginationWithoutLimit = { ...mockPagination, limit: undefined };
      mockQueryBuilder.getMany.mockResolvedValue(mockSessions);

      await repository.getScenarioSessions(
        mockCounselorId,
        paginationWithoutLimit,
      );

      expect(mockQueryBuilder.limit).not.toHaveBeenCalled();
    });

    it('should handle pagination without offset', async () => {
      const mockSessions = [mockScenarioSession];
      const paginationWithoutOffset = { ...mockPagination, offset: undefined };
      mockQueryBuilder.getMany.mockResolvedValue(mockSessions);

      await repository.getScenarioSessions(
        mockCounselorId,
        paginationWithoutOffset,
      );

      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
    });

    it('should apply pagination when offset is zero', async () => {
      const mockSessions = [mockScenarioSession];
      const paginationWithZeroOffset = { ...mockPagination, offset: 0 };
      mockQueryBuilder.getMany.mockResolvedValue(mockSessions);

      await repository.getScenarioSessions(
        mockCounselorId,
        paginationWithZeroOffset,
      );

      // offset: 0 should not call offset method due to falsy check
      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
    });

    it('should handle sorting without sortBy and order', async () => {
      const mockSessions = [mockScenarioSession];
      const paginationWithoutSort = {
        ...mockPagination,
        sortBy: undefined,
        order: undefined,
      };
      mockQueryBuilder.getMany.mockResolvedValue(mockSessions);

      await repository.getScenarioSessions(
        mockCounselorId,
        paginationWithoutSort,
      );

      expect(mockQueryBuilder.orderBy).not.toHaveBeenCalled();
    });
  });

  describe('getAdminScenarioSessions', () => {
    it('should return admin scenario sessions with counselor information', async () => {
      const mockSessions = [{ ...mockScenarioSession, counselor: mockUser }];
      mockQueryBuilder.getMany.mockResolvedValue(mockSessions);

      const result = await repository.getAdminScenarioSessions(mockPagination);

      expect(result).toEqual(mockSessions);
      expect(repository.createQueryBuilder).toHaveBeenCalledWith(
        'scenarioSession',
      );
      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'scenarioSession.scenario',
        Scenarios,
        'scenario',
        'scenario.id = scenarioSession.scenarioId',
      );
      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'scenarioSession.counselor',
        User,
        'counselor',
        'counselor.id = scenarioSession.counselorId',
      );
    });

    it('should apply status filters for admin sessions', async () => {
      const mockSessions = [mockScenarioSession];
      const statuses = 'ACTIVE';
      mockQueryBuilder.getMany.mockResolvedValue(mockSessions);

      const result = await repository.getAdminScenarioSessions(
        mockPagination,
        statuses,
      );

      expect(result).toEqual(mockSessions);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenarioSession.status IN (:...status )',
        { status: ['ACTIVE'] },
      );
    });
  });

  describe('createScenarioSession', () => {
    it('should create a new scenario session', async () => {
      const mockStartDto: StartScenarioSessionRequestDto = {
        scenarioId: mockScenarioId,
      };

      mockUuidV4.mockReturnValue(mockUuid);

      // Mock Date to return a fixed date
      const mockDate = new Date('2024-01-01T10:00:00Z');
      jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);

      const result = await repository.createScenarioSession(
        mockCounselorId,
        mockStartDto,
      );

      expect(result).toEqual({
        id: mockUuid,
        scenarioId: mockScenarioId,
        roomId: `ss_${mockUuid}`,
        counselorId: mockCounselorId,
        startedAt: mockDate,
        tenantId: mockTenantId,
        metadata: { sessionName: 'SS-1-2024-01-01' },
      });

      expect(repository.query).toHaveBeenCalledWith(
        'SELECT last_value from scenario_sessions_id_seq',
      );
      expect(repository.create).toHaveBeenCalledWith({
        id: mockUuid,
        roomId: `ss_${mockUuid}`,
        counselorId: mockCounselorId,
        scenarioId: mockStartDto.scenarioId,
        startedAt: mockDate,
        tenantId: mockTenantId,
        metadata: {
          sessionName: 'SS-1-2024-01-01',
        },
      });
      expect(repository.save).toHaveBeenCalled();

      // Restore Date
      (global.Date as any).mockRestore();
    });

    it('should handle sequence query with no result', async () => {
      const mockStartDto: StartScenarioSessionRequestDto = {
        scenarioId: mockScenarioId,
      };

      mockUuidV4.mockReturnValue(mockUuid);

      jest.spyOn(repository, 'query').mockResolvedValue([]);

      // Mock Date to return a fixed date
      const mockDate = new Date('2024-01-01T10:00:00Z');
      jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);

      const createdScenarioSession = {
        id: mockUuid,
        scenarioId: mockScenarioId,
        roomId: `ss_${mockUuid}`,
        counselorId: mockCounselorId,
        startedAt: mockDate,
        tenantId: mockTenantId,
        metadata: { sessionName: 'SS-undefined-2024-01-01' },
      };

      const result = await repository.createScenarioSession(
        mockCounselorId,
        mockStartDto,
      );

      expect(result).toEqual(createdScenarioSession);

      expect(repository.create).toHaveBeenCalledWith({
        id: mockUuid,
        roomId: `ss_${mockUuid}`,
        counselorId: mockCounselorId,
        scenarioId: mockStartDto.scenarioId,
        startedAt: mockDate,
        tenantId: mockTenantId,
        metadata: {
          sessionName: 'SS-undefined-2024-01-01',
        },
      });

      // Restore Date
      (global.Date as any).mockRestore();
    });
  });

  describe('getScenarioSession', () => {
    it('should return scenario session for counselor', async () => {
      const mockSessionWithDetails = {
        ...mockScenarioSession,
        scenario: mockScenario,
        details: { id: 'details-1' },
        events: [{ id: 'event-1' }],
      };
      mockQueryBuilder.getOne.mockResolvedValue(mockSessionWithDetails);

      const result = await repository.getScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
      );

      expect(result).toEqual(mockSessionWithDetails);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'scenarioSession.id = :scenarioSessionId',
        { scenarioSessionId: mockScenarioSessionId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenarioSession.tenantId = :tenantId',
        { tenantId: mockTenantId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenarioSession.counselorId = :counselorId',
        { counselorId: mockCounselorId },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'scenarioSessionEvent.occurredAt',
        'ASC',
      );
    });

    it('should return scenario session for admin without counselor filter', async () => {
      const mockSessionWithDetails = {
        ...mockScenarioSession,
        scenario: mockScenario,
      };
      mockQueryBuilder.getOne.mockResolvedValue(mockSessionWithDetails);

      const result = await repository.getScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
        true, // isAdmin = true
      );

      expect(result).toEqual(mockSessionWithDetails);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'scenarioSession.id = :scenarioSessionId',
        { scenarioSessionId: mockScenarioSessionId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenarioSession.tenantId = :tenantId',
        { tenantId: mockTenantId },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'scenarioSessionEvent.occurredAt',
        'ASC',
      );
      // Should not filter by counselorId for admin
      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        'scenarioSession.counselorId = :counselorId',
        expect.any(Object),
      );
    });

    it('should include all necessary joins', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(mockScenarioSession);

      await repository.getScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
      );

      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'scenarioSession.scenario',
        Scenarios,
        'scenario',
        'scenario.id = scenarioSession.scenarioId',
      );
      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'scenarioSession.details',
        ScenarioSessionDetails,
        'scenarioSessionDetails',
        '"scenarioSessionDetails"."scenarioSessionId"::uuid = scenarioSession.id',
      );
      expect(mockQueryBuilder.leftJoinAndMapMany).toHaveBeenCalledWith(
        'scenarioSession.events',
        ScenarioSessionEvents,
        'scenarioSessionEvent',
        '"scenarioSessionEvent"."scenarioSessionId"::uuid = scenarioSession.id',
      );
      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'scenarioSessionEvent.events',
        SessionEvents,
        'events',
        'events.id = scenarioSessionEvent.eventId',
      );
    });

    it('should return scenario session with all events (including PASSIVE)', async () => {
      const mockSessionWithMixedEvents = {
        ...mockScenarioSession,
        scenario: mockScenario,
        events: [
          {
            id: 'session-event-1',
            events: {
              id: 'event-1',
              visibilityType: SessionEventVisibilityType.ACTIVE,
            },
          },
          {
            id: 'session-event-2',
            events: {
              id: 'event-2',
              visibilityType: SessionEventVisibilityType.PASSIVE,
            },
          },
        ],
      };
      mockQueryBuilder.getOne.mockResolvedValue(mockSessionWithMixedEvents);

      const result = await repository.getScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
      );

      expect(result).toBeDefined();
      // Repository should return all events without filtering
      expect((result as any).events).toHaveLength(2);
    });

    it('should return scenario session with empty events array when session has no events', async () => {
      const mockSessionWithNoEvents = {
        ...mockScenarioSession,
        scenario: mockScenario,
        events: [],
      };
      mockQueryBuilder.getOne.mockResolvedValue(mockSessionWithNoEvents);

      const result = await repository.getScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
      );

      expect(result).toBeDefined();
      expect(result?.id).toEqual(mockScenarioSessionId);
      expect((result as any).events).toEqual([]);
    });
  });

  describe('getScenarioSessionScore', () => {
    it('should calculate total score from session events', async () => {
      const mockScoreResult = { totalScore: '85.5' };
      mockQueryBuilder.getRawOne.mockResolvedValue(mockScoreResult);

      const result = await repository.getScenarioSessionScore(
        mockScenarioSessionId,
      );

      expect(result).toBe(85.5);
      expect(repository.createQueryBuilder).toHaveBeenCalledWith(
        'scenarioSession',
      );
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith(
        ScenarioSessionEvents,
        'scenarioSessionEvent',
        '"scenarioSessionEvent"."scenarioSessionId"::uuid = scenarioSession.id',
      );
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith(
        SessionEvents,
        'events',
        'events.id = scenarioSessionEvent.eventId AND events.visibilityType = :visibilityType',
      );
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        'COALESCE(SUM(events.score), 0)',
        'totalScore',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'scenarioSession.id = :scenarioSessionId',
        { scenarioSessionId: mockScenarioSessionId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenarioSession.tenantId = :tenantId',
        { tenantId: mockTenantId },
      );
      expect(mockQueryBuilder.setParameters).toHaveBeenCalledWith({
        visibilityType: SessionEventVisibilityType.ACTIVE,
      });
    });

    it('should handle null score result', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue(null);

      const result = await repository.getScenarioSessionScore(
        mockScenarioSessionId,
      );

      expect(result).toBe(0);
    });

    it('should handle undefined totalScore', async () => {
      const mockScoreResult = { totalScore: undefined };
      mockQueryBuilder.getRawOne.mockResolvedValue(mockScoreResult);

      const result = await repository.getScenarioSessionScore(
        mockScenarioSessionId,
      );

      expect(result).toBe(0);
    });

    it('should handle invalid totalScore', async () => {
      const mockScoreResult = { totalScore: 'invalid' };
      mockQueryBuilder.getRawOne.mockResolvedValue(mockScoreResult);

      const result = await repository.getScenarioSessionScore(
        mockScenarioSessionId,
      );

      expect(result).toBe(0);
    });
  });
});
