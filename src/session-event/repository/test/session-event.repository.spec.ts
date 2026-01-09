import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { SessionEventRepository } from '../session-event.repository';
import { SessionEvents } from '../../entity/session-events.entity';
import { SessionEventVisibilityType } from '../../enum/session-event-visibility-type.enum';
import { Pagination } from 'src/common/type/common.type';
import { SessionEventDetectionType } from '../../enum/session-event-detection.enum';
import { CreateSessionEventDto } from '../../dto/session-event.dto';
import { SYSTEM_EVENT_DETECTION_TYPES } from '../../constants/event.constant';

describe('SessionEventRepository', () => {
  let repository: SessionEventRepository;
  let queryBuilder: jest.Mocked<SelectQueryBuilder<SessionEvents>>;

  const mockSessionEvent: SessionEvents = {
    id: 'event-1',
    name: 'Test Event',
    description: 'Test description',
    score: 85,
    emoji: '👍',
    message: 'Great job!',
    branchInstruction: 'Continue',
    detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
    visibilityType: SessionEventVisibilityType.ACTIVE,
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-01-01T10:00:00Z'),
    eventCode: 'SS1',
  };

  beforeEach(async () => {
    queryBuilder = {
      andWhere: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    } as any;

    const mockEntityManager = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    const mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue(mockEntityManager),
      query: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionEventRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<SessionEventRepository>(SessionEventRepository);

    // Mock the createQueryBuilder method on the repository instance
    repository.createQueryBuilder = jest.fn().mockReturnValue(queryBuilder);
    // Mock the query method
    repository.query = jest.fn();
    // Mock the create method
    repository.create = jest.fn();
    // Mock the save method
    repository.save = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllSessionEvents', () => {
    it('should get all session events without filters', async () => {
      const expectedEvents = [mockSessionEvent];
      queryBuilder.getMany.mockResolvedValue(expectedEvents);

      const result = await repository.getAllSessionEvents();

      expect(repository.createQueryBuilder).toHaveBeenCalledWith(
        'sessionEvent',
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        `CASE WHEN sessionEvent.detectionType IN (:...SYSTEM_EVENT_DETECTION_TYPES) THEN 1 ELSE 0 END`,
        'ASC',
      );
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        SYSTEM_EVENT_DETECTION_TYPES,
      });
      expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(
        'sessionEvent.createdAt',
        'DESC',
      );
      expect(queryBuilder.getMany).toHaveBeenCalled();
      expect(result).toEqual(expectedEvents);
    });

    it('should get session events with visibility type filter', async () => {
      const expectedEvents = [mockSessionEvent];
      const visibilityType = SessionEventVisibilityType.ACTIVE;
      queryBuilder.getMany.mockResolvedValue(expectedEvents);

      const result = await repository.getAllSessionEvents(visibilityType);

      expect(repository.createQueryBuilder).toHaveBeenCalledWith(
        'sessionEvent',
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'sessionEvent.visibilityType = :visibilityType',
        { visibilityType: visibilityType },
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        `CASE WHEN sessionEvent.detectionType IN (:...SYSTEM_EVENT_DETECTION_TYPES) THEN 1 ELSE 0 END`,
        'ASC',
      );
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        SYSTEM_EVENT_DETECTION_TYPES,
      });
      expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(
        'sessionEvent.createdAt',
        'DESC',
      );
      expect(queryBuilder.getMany).toHaveBeenCalled();
      expect(result).toEqual(expectedEvents);
    });

    it('should get session events with pagination', async () => {
      const expectedEvents = [mockSessionEvent];
      const pagination: Pagination = {
        limit: 10,
        offset: 5,
        sortBy: 'name',
        order: 'ASC',
      };
      queryBuilder.getMany.mockResolvedValue(expectedEvents);

      const result = await repository.getAllSessionEvents(
        undefined,
        undefined,
        pagination,
      );

      expect(repository.createQueryBuilder).toHaveBeenCalledWith(
        'sessionEvent',
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        `CASE WHEN sessionEvent.detectionType IN (:...SYSTEM_EVENT_DETECTION_TYPES) THEN 1 ELSE 0 END`,
        'ASC',
      );
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        SYSTEM_EVENT_DETECTION_TYPES,
      });
      expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(
        'sessionEvent.name',
        'ASC',
      );
      expect(queryBuilder.limit).toHaveBeenCalledWith(10);
      expect(queryBuilder.offset).toHaveBeenCalledWith(5);
      expect(queryBuilder.getMany).toHaveBeenCalled();
      expect(result).toEqual(expectedEvents);
    });

    it('should get session events with both visibility type and pagination', async () => {
      const expectedEvents = [mockSessionEvent];
      const visibilityType = SessionEventVisibilityType.PASSIVE;
      const pagination: Pagination = {
        limit: 20,
        offset: 5, // Changed from 0 to 5 to test offset functionality
        sortBy: 'score',
        order: 'DESC',
      };
      queryBuilder.getMany.mockResolvedValue(expectedEvents);

      const result = await repository.getAllSessionEvents(
        visibilityType,
        undefined,
        pagination,
      );

      expect(repository.createQueryBuilder).toHaveBeenCalledWith(
        'sessionEvent',
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'sessionEvent.visibilityType = :visibilityType',
        { visibilityType: visibilityType },
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        `CASE WHEN sessionEvent.detectionType IN (:...SYSTEM_EVENT_DETECTION_TYPES) THEN 1 ELSE 0 END`,
        'ASC',
      );
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        SYSTEM_EVENT_DETECTION_TYPES,
      });
      expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(
        'sessionEvent.score',
        'DESC',
      );
      expect(queryBuilder.limit).toHaveBeenCalledWith(20);
      expect(queryBuilder.offset).toHaveBeenCalledWith(5);
      expect(queryBuilder.getMany).toHaveBeenCalled();
      expect(result).toEqual(expectedEvents);
    });

    it('should apply default sorting when no pagination provided', async () => {
      const expectedEvents = [mockSessionEvent];
      queryBuilder.getMany.mockResolvedValue(expectedEvents);

      const result = await repository.getAllSessionEvents();

      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        `CASE WHEN sessionEvent.detectionType IN (:...SYSTEM_EVENT_DETECTION_TYPES) THEN 1 ELSE 0 END`,
        'ASC',
      );
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        SYSTEM_EVENT_DETECTION_TYPES,
      });
      expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(
        'sessionEvent.createdAt',
        'DESC',
      );
      expect(result).toEqual(expectedEvents);
    });

    it('should not apply limit when pagination limit is not provided', async () => {
      const expectedEvents = [mockSessionEvent];
      const pagination: Pagination = {
        sortBy: 'name',
        order: 'ASC',
      };
      queryBuilder.getMany.mockResolvedValue(expectedEvents);

      const result = await repository.getAllSessionEvents(
        undefined,
        undefined,
        pagination,
      );

      expect(queryBuilder.limit).not.toHaveBeenCalled();
      expect(queryBuilder.offset).not.toHaveBeenCalled();
      expect(result).toEqual(expectedEvents);
    });

    it('should not apply offset when pagination offset is 0 (falsy)', async () => {
      const expectedEvents = [mockSessionEvent];
      const pagination: Pagination = {
        limit: 10,
        offset: 0, // This should not trigger offset due to falsy check
        sortBy: 'name',
        order: 'ASC',
      };
      queryBuilder.getMany.mockResolvedValue(expectedEvents);

      const result = await repository.getAllSessionEvents(
        undefined,
        undefined,
        pagination,
      );

      expect(queryBuilder.limit).toHaveBeenCalledWith(10);
      expect(queryBuilder.offset).not.toHaveBeenCalled(); // Should not be called for 0
      expect(result).toEqual(expectedEvents);
    });

    it('should not apply offset when pagination offset is not provided', async () => {
      const expectedEvents = [mockSessionEvent];
      const pagination: Pagination = {
        limit: 10,
        sortBy: 'name',
        order: 'ASC',
      };
      queryBuilder.getMany.mockResolvedValue(expectedEvents);

      const result = await repository.getAllSessionEvents(
        undefined,
        undefined,
        pagination,
      );

      expect(queryBuilder.limit).toHaveBeenCalledWith(10);
      expect(queryBuilder.offset).not.toHaveBeenCalled();
      expect(result).toEqual(expectedEvents);
    });

    it('should handle query builder error', async () => {
      const error = new Error('Database query failed');
      queryBuilder.getMany.mockRejectedValue(error);

      await expect(repository.getAllSessionEvents()).rejects.toThrow(
        'Database query failed',
      );
      expect(repository.createQueryBuilder).toHaveBeenCalledWith(
        'sessionEvent',
      );
    });

    it('should return empty array when no events found', async () => {
      const expectedEvents: SessionEvents[] = [];
      queryBuilder.getMany.mockResolvedValue(expectedEvents);

      const result = await repository.getAllSessionEvents();

      expect(queryBuilder.getMany).toHaveBeenCalled();
      expect(result).toEqual(expectedEvents);
    });

    it('should filter by searchName', async () => {
      const expectedEvents = [mockSessionEvent];
      const searchName = 'Test';
      queryBuilder.getMany.mockResolvedValue(expectedEvents);

      const result = await repository.getAllSessionEvents(
        undefined,
        searchName,
        undefined,
      );

      expect(repository.createQueryBuilder).toHaveBeenCalledWith(
        'sessionEvent',
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '(sessionEvent.name ILIKE :searchName OR sessionEvent.eventCode ILIKE :searchName)',
      );
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        searchName: '%Test%',
      });
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        `CASE WHEN sessionEvent.detectionType IN (:...SYSTEM_EVENT_DETECTION_TYPES) THEN 1 ELSE 0 END`,
        'ASC',
      );
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        SYSTEM_EVENT_DETECTION_TYPES,
      });
      expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(
        'sessionEvent.createdAt',
        'DESC',
      );
      expect(queryBuilder.getMany).toHaveBeenCalled();
      expect(result).toEqual(expectedEvents);
    });

    it('should filter by both visibility type and searchName', async () => {
      const expectedEvents = [mockSessionEvent];
      const visibilityType = SessionEventVisibilityType.ACTIVE;
      const searchName = 'Event';
      queryBuilder.getMany.mockResolvedValue(expectedEvents);

      const result = await repository.getAllSessionEvents(
        visibilityType,
        searchName,
        undefined,
      );

      expect(repository.createQueryBuilder).toHaveBeenCalledWith(
        'sessionEvent',
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'sessionEvent.visibilityType = :visibilityType',
        { visibilityType: visibilityType },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '(sessionEvent.name ILIKE :searchName OR sessionEvent.eventCode ILIKE :searchName)',
      );
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        searchName: '%Event%',
      });
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        `CASE WHEN sessionEvent.detectionType IN (:...SYSTEM_EVENT_DETECTION_TYPES) THEN 1 ELSE 0 END`,
        'ASC',
      );
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        SYSTEM_EVENT_DETECTION_TYPES,
      });
      expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(
        'sessionEvent.createdAt',
        'DESC',
      );
      expect(queryBuilder.getMany).toHaveBeenCalled();
      expect(result).toEqual(expectedEvents);
    });

    it('should filter by searchName with pagination', async () => {
      const expectedEvents = [mockSessionEvent];
      const searchName = 'Test';
      const pagination: Pagination = {
        limit: 10,
        offset: 5,
        sortBy: 'name',
        order: 'ASC',
      };
      queryBuilder.getMany.mockResolvedValue(expectedEvents);

      const result = await repository.getAllSessionEvents(
        undefined,
        searchName,
        pagination,
      );

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '(sessionEvent.name ILIKE :searchName OR sessionEvent.eventCode ILIKE :searchName)',
      );
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        searchName: '%Test%',
      });
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        `CASE WHEN sessionEvent.detectionType IN (:...SYSTEM_EVENT_DETECTION_TYPES) THEN 1 ELSE 0 END`,
        'ASC',
      );
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        SYSTEM_EVENT_DETECTION_TYPES,
      });
      expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(
        'sessionEvent.name',
        'ASC',
      );
      expect(queryBuilder.limit).toHaveBeenCalledWith(10);
      expect(queryBuilder.offset).toHaveBeenCalledWith(5);
      expect(result).toEqual(expectedEvents);
    });

    it('should handle all filters together: visibilityType, searchName, and pagination', async () => {
      const expectedEvents = [mockSessionEvent];
      const visibilityType = SessionEventVisibilityType.PASSIVE;
      const searchName = 'Great';
      const pagination: Pagination = {
        limit: 20,
        offset: 10,
        sortBy: 'score',
        order: 'DESC',
      };
      queryBuilder.getMany.mockResolvedValue(expectedEvents);

      const result = await repository.getAllSessionEvents(
        visibilityType,
        searchName,
        pagination,
      );

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'sessionEvent.visibilityType = :visibilityType',
        { visibilityType: visibilityType },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '(sessionEvent.name ILIKE :searchName OR sessionEvent.eventCode ILIKE :searchName)',
      );
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        searchName: '%Great%',
      });
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        `CASE WHEN sessionEvent.detectionType IN (:...SYSTEM_EVENT_DETECTION_TYPES) THEN 1 ELSE 0 END`,
        'ASC',
      );
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        SYSTEM_EVENT_DETECTION_TYPES,
      });
      expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(
        'sessionEvent.score',
        'DESC',
      );
      expect(queryBuilder.limit).toHaveBeenCalledWith(20);
      expect(queryBuilder.offset).toHaveBeenCalledWith(10);
      expect(result).toEqual(expectedEvents);
    });

    it('should handle empty searchName string', async () => {
      const expectedEvents = [mockSessionEvent];
      queryBuilder.getMany.mockResolvedValue(expectedEvents);

      const result = await repository.getAllSessionEvents(
        undefined,
        '',
        undefined,
      );

      // Empty string is falsy, so andWhere for searchName should not be called
      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
      // setParameters is still called for SYSTEM_EVENT_DETECTION_TYPES (sorting)
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        SYSTEM_EVENT_DETECTION_TYPES,
      });
      expect(queryBuilder.setParameters).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expectedEvents);
    });

    it('should handle searchName with special characters', async () => {
      const expectedEvents = [mockSessionEvent];
      const searchName = "Test's Event";
      queryBuilder.getMany.mockResolvedValue(expectedEvents);

      const result = await repository.getAllSessionEvents(
        undefined,
        searchName,
        undefined,
      );

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '(sessionEvent.name ILIKE :searchName OR sessionEvent.eventCode ILIKE :searchName)',
      );
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        searchName: "%Test's Event%",
      });
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        `CASE WHEN sessionEvent.detectionType IN (:...SYSTEM_EVENT_DETECTION_TYPES) THEN 1 ELSE 0 END`,
        'ASC',
      );
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        SYSTEM_EVENT_DETECTION_TYPES,
      });
      expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(
        'sessionEvent.createdAt',
        'DESC',
      );
      expect(result).toEqual(expectedEvents);
    });

    it('should apply sorting with SYSTEM_EVENT_DETECTION_TYPES to push helper events last', async () => {
      const regularEvent: SessionEvents = {
        ...mockSessionEvent,
        id: 'regular-1',
        detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
      };

      const helperEvent: SessionEvents = {
        ...mockSessionEvent,
        id: 'helper-1',
        detectionType: SessionEventDetectionType.HELPER_PARAPHRASED,
      };

      const expectedEvents = [regularEvent, helperEvent];
      queryBuilder.getMany.mockResolvedValue(expectedEvents);

      await repository.getAllSessionEvents();

      // Verify the CASE expression is used to push system events last
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        `CASE WHEN sessionEvent.detectionType IN (:...SYSTEM_EVENT_DETECTION_TYPES) THEN 1 ELSE 0 END`,
        'ASC',
      );
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        SYSTEM_EVENT_DETECTION_TYPES,
      });
    });

    it('should include all HELPER detection types in SYSTEM_EVENT_DETECTION_TYPES', () => {
      // Verify SYSTEM_EVENT_DETECTION_TYPES contains all helper types
      expect(SYSTEM_EVENT_DETECTION_TYPES).toContain(
        SessionEventDetectionType.HELPER_PARAPHRASED,
      );
      expect(SYSTEM_EVENT_DETECTION_TYPES).toContain(
        SessionEventDetectionType.HELPER_INTERRUPTED,
      );
      expect(SYSTEM_EVENT_DETECTION_TYPES).toContain(
        SessionEventDetectionType.HELPER_UTTERANCE_LENGTH,
      );
      expect(SYSTEM_EVENT_DETECTION_TYPES).toHaveLength(3);
    });

    it('should not include regular detection types in SYSTEM_EVENT_DETECTION_TYPES', () => {
      const regularDetectionTypes = [
        SessionEventDetectionType.SENTENCE_SIMILARITY,
        SessionEventDetectionType.SEMANTIC_SIMILARITY,
        SessionEventDetectionType.TIME,
        SessionEventDetectionType.SCORE,
        SessionEventDetectionType.COMBINATION,
        SessionEventDetectionType.BINARY_CLASSIFIER,
      ];

      for (const detectionType of regularDetectionTypes) {
        expect(SYSTEM_EVENT_DETECTION_TYPES).not.toContain(detectionType);
      }
    });
  });

  describe('createSessionEvents', () => {
    const mockCreateEventDto: CreateSessionEventDto = {
      name: 'Test Event',
      description: 'Test description',
      score: 85,
      emoji: '👍',
      message: 'Great job!',
      branchInstruction: 'Continue',
      detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
      visibilityType: SessionEventVisibilityType.ACTIVE,
      detectionData: {
        sentences: ['Sentence 1', 'Sentence 2'],
      },
    };

    it('should create a single session event successfully', async () => {
      const sequenceValue = 1;
      const expectedEventCode = 'SS1';
      const createdEvent = {
        ...mockCreateEventDto,
        id: expect.any(String),
        eventCode: expectedEventCode,
      };

      (repository.query as jest.Mock).mockResolvedValue([
        { next_value: sequenceValue },
      ]);
      (repository.create as jest.Mock).mockReturnValue(createdEvent);
      (repository.save as jest.Mock).mockResolvedValue([createdEvent]);

      const result = await repository.createSessionEvents([mockCreateEventDto]);

      expect(repository.query).toHaveBeenCalledWith(
        `SELECT nextval('session_events_event_code_seq') as next_value`,
      );
      expect(repository.create).toHaveBeenCalledWith({
        ...mockCreateEventDto,
        eventCode: expectedEventCode,
      });
      expect(repository.save).toHaveBeenCalledWith([createdEvent]);
      expect(result).toEqual([createdEvent]);
    });

    it('should create multiple session events with unique sequence values', async () => {
      const createEventDtos = [
        mockCreateEventDto,
        { ...mockCreateEventDto, name: 'Second Event' },
      ];

      (repository.query as jest.Mock)
        .mockResolvedValueOnce([{ next_value: 1 }])
        .mockResolvedValueOnce([{ next_value: 2 }]);

      const createdEvent1 = {
        ...mockCreateEventDto,
        id: expect.any(String),
        eventCode: 'SS1',
      };
      const createdEvent2 = {
        ...mockCreateEventDto,
        name: 'Second Event',
        id: expect.any(String),
        eventCode: 'SS2',
      };

      (repository.create as jest.Mock)
        .mockReturnValueOnce(createdEvent1)
        .mockReturnValueOnce(createdEvent2);
      (repository.save as jest.Mock).mockResolvedValue([
        createdEvent1,
        createdEvent2,
      ]);

      const result = await repository.createSessionEvents(createEventDtos);

      expect(repository.query).toHaveBeenCalledTimes(2);
      expect(repository.create).toHaveBeenCalledTimes(2);
      expect(repository.save).toHaveBeenCalledWith([
        createdEvent1,
        createdEvent2,
      ]);
      expect(result).toEqual([createdEvent1, createdEvent2]);
    });

    it('should use correct prefix for different detection types', async () => {
      const detectionTypes = [
        {
          type: SessionEventDetectionType.SENTENCE_SIMILARITY,
          expectedPrefix: 'SS',
        },
        {
          type: SessionEventDetectionType.SEMANTIC_SIMILARITY,
          expectedPrefix: 'SM',
        },
        { type: SessionEventDetectionType.TIME, expectedPrefix: 'TI' },
        { type: SessionEventDetectionType.SCORE, expectedPrefix: 'SC' },
        {
          type: SessionEventDetectionType.COMBINATION,
          expectedPrefix: 'CO',
        },
      ];

      for (const detectionType of detectionTypes) {
        jest.clearAllMocks();

        const eventDto = {
          ...mockCreateEventDto,
          detectionType: detectionType.type,
        };

        (repository.query as jest.Mock).mockResolvedValue([{ next_value: 1 }]);
        const createdEvent = {
          ...eventDto,
          id: expect.any(String),
          eventCode: `${detectionType.expectedPrefix}1`,
        };
        (repository.create as jest.Mock).mockReturnValue(createdEvent);
        (repository.save as jest.Mock).mockResolvedValue([createdEvent]);

        await repository.createSessionEvents([eventDto]);

        expect(repository.create).toHaveBeenCalledWith(
          expect.objectContaining({
            eventCode: `${detectionType.expectedPrefix}1`,
          }),
        );
      }
    });

    it('should use default detection type when not provided', async () => {
      const eventDtoWithoutDetectionType = {
        ...mockCreateEventDto,
        detectionType: undefined,
      };

      (repository.query as jest.Mock).mockResolvedValue([{ next_value: 1 }]);
      const createdEvent = {
        ...eventDtoWithoutDetectionType,
        id: expect.any(String),
        eventCode: 'SS1',
        detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
      };
      (repository.create as jest.Mock).mockReturnValue(createdEvent);
      (repository.save as jest.Mock).mockResolvedValue([createdEvent]);

      await repository.createSessionEvents([eventDtoWithoutDetectionType]);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventCode: 'SS1',
        }),
      );
    });

    it('should handle empty array input', async () => {
      (repository.save as jest.Mock).mockResolvedValue([]);

      const result = await repository.createSessionEvents([]);

      expect(repository.query).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.save).toHaveBeenCalledWith([]);
      expect(result).toEqual([]);
    });

    it('should handle null sequence result with fallback', async () => {
      (repository.query as jest.Mock).mockResolvedValue([{ next_value: null }]);
      const createdEvent = {
        ...mockCreateEventDto,
        id: expect.any(String),
        eventCode: 'SS0',
      };
      (repository.create as jest.Mock).mockReturnValue(createdEvent);
      (repository.save as jest.Mock).mockResolvedValue([createdEvent]);

      await repository.createSessionEvents([mockCreateEventDto]);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventCode: 'SS0',
        }),
      );
    });

    it('should handle query error', async () => {
      const error = new Error('Database query failed');
      (repository.query as jest.Mock).mockRejectedValue(error);

      await expect(
        repository.createSessionEvents([mockCreateEventDto]),
      ).rejects.toThrow('Database query failed');
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('should handle save error', async () => {
      const error = new Error('Save failed');
      (repository.query as jest.Mock).mockResolvedValue([{ next_value: 1 }]);
      const createdEvent = {
        ...mockCreateEventDto,
        id: expect.any(String),
        eventCode: 'SS1',
      };
      (repository.create as jest.Mock).mockReturnValue(createdEvent);
      (repository.save as jest.Mock).mockRejectedValue(error);

      await expect(
        repository.createSessionEvents([mockCreateEventDto]),
      ).rejects.toThrow('Save failed');
      expect(repository.query).toHaveBeenCalled();
      expect(repository.create).toHaveBeenCalled();
    });

    it('should preserve all event properties when creating', async () => {
      const fullEventDto: CreateSessionEventDto = {
        name: 'Full Event',
        description: 'Full description',
        score: 90,
        emoji: '🎉',
        message: 'Excellent!',
        branchInstruction: 'Move forward',
        detectionType: SessionEventDetectionType.SCORE,
        visibilityType: SessionEventVisibilityType.PASSIVE,
        detectionData: {
          score: 85,
          condition: 'GTE' as any,
        },
      };

      (repository.query as jest.Mock).mockResolvedValue([{ next_value: 5 }]);
      const createdEvent = {
        ...fullEventDto,
        id: expect.any(String),
        eventCode: 'SC5',
      };
      (repository.create as jest.Mock).mockReturnValue(createdEvent);
      (repository.save as jest.Mock).mockResolvedValue([createdEvent]);

      await repository.createSessionEvents([fullEventDto]);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: fullEventDto.name,
          description: fullEventDto.description,
          score: fullEventDto.score,
          emoji: fullEventDto.emoji,
          message: fullEventDto.message,
          branchInstruction: fullEventDto.branchInstruction,
          detectionType: fullEventDto.detectionType,
          visibilityType: fullEventDto.visibilityType,
          detectionData: fullEventDto.detectionData,
          eventCode: 'SC5',
        }),
      );
    });
  });
});
