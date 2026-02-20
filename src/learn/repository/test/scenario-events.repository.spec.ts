import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { ScenarioEventsRepository } from '../scenario-events.repository';
import { ScenarioEvents } from '../../entity/scenario-events.entity';
import { Pagination } from 'src/common/type/common.type';

describe('ScenarioEventsRepository', () => {
  let repository: ScenarioEventsRepository;
  let mockQueryBuilder: jest.Mocked<SelectQueryBuilder<ScenarioEvents>>;

  const mockScenarioEvents = [
    {
      id: 'event-1',
      scenarioId: 1,
      eventId: 'event-1',
      feedbackStatus: true,
      emoji: '👍',
      message: 'Great job!',
      score: 85,
      branchingStatus: true,
      branchInstruction: 'Continue with next step',
      checklistVisibilityStatus: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'event-2',
      scenarioId: 1,
      eventId: 'event-2',
      feedbackStatus: false,
      emoji: undefined,
      message: undefined,
      score: undefined,
      branchingStatus: false,
      branchInstruction: undefined,
      checklistVisibilityStatus: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const mockPagination: Pagination = {
    limit: 10,
    offset: 0,
    sortBy: 'createdAt',
    order: 'ASC',
  };

  beforeEach(async () => {
    mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      leftJoinAndMapOne: jest.fn().mockReturnThis(),
      leftJoinAndMapMany: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(),
      getMany: jest.fn(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
    } as any;

    const mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue({
        getRepository: jest.fn(),
      }),
    };

    const mockRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioEventsRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: getRepositoryToken(ScenarioEvents),
          useValue: mockRepository,
        },
      ],
    }).compile();

    repository = module.get<ScenarioEventsRepository>(ScenarioEventsRepository);

    // Mock the repository's createQueryBuilder method
    jest
      .spyOn(repository, 'createQueryBuilder')
      .mockReturnValue(mockQueryBuilder);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getScenarioEvents', () => {
    const scenarioId = 1;

    it('should return scenario events with count', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([
        mockScenarioEvents,
        2,
      ]);

      const result = await repository.getScenarioEvents(scenarioId);

      expect(result).toEqual({
        data: mockScenarioEvents,
        count: 2,
      });

      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'scenarioEvent.sessionEvent',
        expect.anything(),
        'sessionEvent',
        'sessionEvent.id = scenarioEvent.eventId',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'scenarioEvent.scenarioId = :scenarioId',
        { scenarioId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenarioEvent.autoTerminationStatus = :autoTerminationStatus',
        { autoTerminationStatus: false },
      );
    });

    it('should return scenario events with pagination', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([
        mockScenarioEvents,
        2,
      ]);

      const result = await repository.getScenarioEvents(
        scenarioId,
        mockPagination,
      );

      expect(result).toEqual({
        data: mockScenarioEvents,
        count: 2,
      });

      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'scenarioEvent.sessionEvent',
        expect.anything(),
        'sessionEvent',
        'sessionEvent.id = scenarioEvent.eventId',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'scenarioEvent.scenarioId = :scenarioId',
        { scenarioId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenarioEvent.autoTerminationStatus = :autoTerminationStatus',
        { autoTerminationStatus: false },
      );
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      // offset: 0 is falsy, so it should not be called
      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
      // sortBy is provided, so orderBy should be called
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'scenarioEvent.createdAt',
        'ASC',
      );
    });

    it('should return scenario events without pagination when options not provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([
        mockScenarioEvents,
        2,
      ]);

      const result = await repository.getScenarioEvents(scenarioId);

      expect(result).toEqual({
        data: mockScenarioEvents,
        count: 2,
      });

      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'scenarioEvent.sessionEvent',
        expect.anything(),
        'sessionEvent',
        'sessionEvent.id = scenarioEvent.eventId',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'scenarioEvent.scenarioId = :scenarioId',
        { scenarioId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenarioEvent.autoTerminationStatus = :autoTerminationStatus',
        { autoTerminationStatus: false },
      );
      expect(mockQueryBuilder.limit).not.toHaveBeenCalled();
      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
      // No sortBy provided, so orderBy should not be called
      expect(mockQueryBuilder.orderBy).not.toHaveBeenCalled();
    });

    it('should return empty data when no events found', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const result = await repository.getScenarioEvents(scenarioId);

      expect(result).toEqual({
        data: [],
        count: 0,
      });
      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'scenarioEvent.sessionEvent',
        expect.anything(),
        'sessionEvent',
        'sessionEvent.id = scenarioEvent.eventId',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'scenarioEvent.scenarioId = :scenarioId',
        { scenarioId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenarioEvent.autoTerminationStatus = :autoTerminationStatus',
        { autoTerminationStatus: false },
      );
    });

    it('should handle different scenario IDs', async () => {
      const differentScenarioId = 999;
      mockQueryBuilder.getManyAndCount.mockResolvedValue([
        [mockScenarioEvents[0]],
        1,
      ]);

      await repository.getScenarioEvents(differentScenarioId);

      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'scenarioEvent.sessionEvent',
        expect.anything(),
        'sessionEvent',
        'sessionEvent.id = scenarioEvent.eventId',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'scenarioEvent.scenarioId = :scenarioId',
        { scenarioId: differentScenarioId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenarioEvent.autoTerminationStatus = :autoTerminationStatus',
        { autoTerminationStatus: false },
      );
    });

    it('should apply pagination correctly', async () => {
      const customPagination: Pagination = {
        limit: 5,
        offset: 10,
        sortBy: 'updatedAt',
        order: 'DESC',
      };

      mockQueryBuilder.getManyAndCount.mockResolvedValue([
        mockScenarioEvents,
        2,
      ]);

      await repository.getScenarioEvents(scenarioId, customPagination);

      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'scenarioEvent.sessionEvent',
        expect.anything(),
        'sessionEvent',
        'sessionEvent.id = scenarioEvent.eventId',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'scenarioEvent.scenarioId = :scenarioId',
        { scenarioId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenarioEvent.autoTerminationStatus = :autoTerminationStatus',
        { autoTerminationStatus: false },
      );
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(5);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(10);
    });

    it('should handle database errors', async () => {
      const error = new Error('Database connection failed');
      mockQueryBuilder.getManyAndCount.mockRejectedValue(error);

      await expect(repository.getScenarioEvents(scenarioId)).rejects.toThrow(
        'Database connection failed',
      );
    });

    it('should handle query builder errors', async () => {
      const error = new Error('Query execution failed');
      mockQueryBuilder.getManyAndCount.mockRejectedValue(error);

      await expect(repository.getScenarioEvents(scenarioId)).rejects.toThrow(
        'Query execution failed',
      );
    });

    it('should return events with all expected fields', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([
        [mockScenarioEvents[0]],
        1,
      ]);

      const result = await repository.getScenarioEvents(scenarioId);

      expect(result.data).toEqual([mockScenarioEvents[0]]);
      expect(result.count).toBe(1);
      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'scenarioEvent.sessionEvent',
        expect.anything(),
        'sessionEvent',
        'sessionEvent.id = scenarioEvent.eventId',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'scenarioEvent.scenarioId = :scenarioId',
        { scenarioId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenarioEvent.autoTerminationStatus = :autoTerminationStatus',
        { autoTerminationStatus: false },
      );
    });

    it('should handle null values in event data', async () => {
      const eventsWithNulls = [
        {
          id: 'event-null-1',
          scenarioId: 1,
          eventId: 'event-1',
          feedbackStatus: false,
          emoji: undefined,
          message: undefined,
          score: undefined,
          branchingStatus: false,
          branchInstruction: undefined,
          checklistVisibilityStatus: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockQueryBuilder.getManyAndCount.mockResolvedValue([eventsWithNulls, 1]);

      const result = await repository.getScenarioEvents(scenarioId);

      expect(result.data).toEqual(eventsWithNulls);
      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'scenarioEvent.sessionEvent',
        expect.anything(),
        'sessionEvent',
        'sessionEvent.id = scenarioEvent.eventId',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'scenarioEvent.scenarioId = :scenarioId',
        { scenarioId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenarioEvent.autoTerminationStatus = :autoTerminationStatus',
        { autoTerminationStatus: false },
      );
    });

    it('should handle large pagination limits', async () => {
      const largePagination: Pagination = {
        limit: 1000,
        offset: 0,
        sortBy: 'createdAt',
        order: 'ASC',
      };

      mockQueryBuilder.getManyAndCount.mockResolvedValue([
        mockScenarioEvents,
        500,
      ]);

      await repository.getScenarioEvents(scenarioId, largePagination);

      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'scenarioEvent.sessionEvent',
        expect.anything(),
        'sessionEvent',
        'sessionEvent.id = scenarioEvent.eventId',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'scenarioEvent.scenarioId = :scenarioId',
        { scenarioId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenarioEvent.autoTerminationStatus = :autoTerminationStatus',
        { autoTerminationStatus: false },
      );
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(1000);
    });
  });

  describe('applyPagination', () => {
    it('should apply limit when provided', () => {
      const query = mockQueryBuilder;
      const options: Pagination = { limit: 20 };

      // Access private method through any type
      (repository as any).applyPagination(query, options);

      expect(query.limit).toHaveBeenCalledWith(20);
    });

    it('should apply offset when provided', () => {
      const query = mockQueryBuilder;
      const options: Pagination = { offset: 50 };

      (repository as any).applyPagination(query, options);

      expect(query.offset).toHaveBeenCalledWith(50);
    });

    it('should not apply pagination when options not provided', () => {
      const query = mockQueryBuilder;

      (repository as any).applyPagination(query, undefined);

      expect(query.limit).not.toHaveBeenCalled();
      expect(query.offset).not.toHaveBeenCalled();
    });

    it('should apply both limit and offset when both provided', () => {
      const query = mockQueryBuilder;
      const options: Pagination = { limit: 15, offset: 30 };

      (repository as any).applyPagination(query, options);

      expect(query.limit).toHaveBeenCalledWith(15);
      expect(query.offset).toHaveBeenCalledWith(30);
    });

    it('should handle zero values', () => {
      const query = mockQueryBuilder;
      const options: Pagination = { limit: 0, offset: 0 };

      (repository as any).applyPagination(query, options);

      // Zero values are falsy, so they should not be applied
      expect(query.limit).not.toHaveBeenCalled();
      expect(query.offset).not.toHaveBeenCalled();
    });
  });

  describe('applySort', () => {
    it('should apply sortBy and order when provided', () => {
      const query = mockQueryBuilder;
      const options: Pagination = { sortBy: 'createdAt', order: 'ASC' };

      (repository as any).applySort(query, options);

      expect(query.orderBy).toHaveBeenCalledWith(
        'scenarioEvent.createdAt',
        'ASC',
      );
    });

    it('should apply sortBy with default order when only sortBy provided', () => {
      const query = mockQueryBuilder;
      const options: Pagination = { sortBy: 'updatedAt' };

      (repository as any).applySort(query, options);

      expect(query.orderBy).toHaveBeenCalledWith(
        'scenarioEvent.updatedAt',
        'DESC',
      );
    });

    it('should not apply sort when sortBy not provided', () => {
      const query = mockQueryBuilder;
      const options: Pagination = { order: 'ASC' };

      (repository as any).applySort(query, options);

      expect(query.orderBy).not.toHaveBeenCalled();
    });

    it('should not apply sort when options not provided', () => {
      const query = mockQueryBuilder;

      (repository as any).applySort(query, undefined);

      expect(query.orderBy).not.toHaveBeenCalled();
    });

    it('should handle different sort fields', () => {
      const query = mockQueryBuilder;
      const options: Pagination = { sortBy: 'eventId', order: 'DESC' };

      (repository as any).applySort(query, options);

      expect(query.orderBy).toHaveBeenCalledWith(
        'scenarioEvent.eventId',
        'DESC',
      );
    });
  });

  describe('getEventChecklist', () => {
    const scenarioSessionId = 'session-uuid-123';
    const scenarioId = 1;

    it('should build query with correct joins and filters', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      await repository.getEventChecklist(scenarioSessionId, scenarioId);

      expect(mockQueryBuilder.leftJoinAndMapMany).toHaveBeenCalledWith(
        'scenarioEvent.scenarioSessionEvent',
        expect.anything(),
        'scenarioSessionEvent',
        'scenarioSessionEvent.eventId = scenarioEvent.eventId AND scenarioSessionEvent.scenarioSessionId = :scenarioSessionId',
      );
      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'scenarioEvent.events',
        expect.anything(),
        'events',
        'events.id = scenarioEvent.eventId',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'scenarioEvent.scenarioId = :scenarioId',
        { scenarioId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(scenarioEvent.checklistVisibilityStatus = :checklistVisible OR scenarioSessionEvent.id IS NOT NULL)',
        { checklistVisible: true },
      );
      expect(mockQueryBuilder.setParameters).toHaveBeenCalledWith({
        scenarioSessionId,
      });
    });

    it('should return events with mapped session events and event details', async () => {
      const mockChecklistData = [
        {
          id: 'se-1',
          eventId: 'event-1',
          scenarioId: 1,
          checklistVisibilityStatus: true,
          events: { id: 'event-1', name: 'Empathy Check' },
          scenarioSessionEvent: [
            {
              id: 'sse-1',
              eventId: 'event-1',
              scenarioSessionId: scenarioSessionId,
            },
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'se-2',
          eventId: 'event-2',
          scenarioId: 1,
          checklistVisibilityStatus: true,
          events: { id: 'event-2', name: 'Greeting' },
          scenarioSessionEvent: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockQueryBuilder.getMany.mockResolvedValue(mockChecklistData);

      const result = await repository.getEventChecklist(
        scenarioSessionId,
        scenarioId,
      );

      expect(result).toEqual(mockChecklistData);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no matching events exist', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      const result = await repository.getEventChecklist(
        scenarioSessionId,
        scenarioId,
      );

      expect(result).toEqual([]);
    });
  });
});
