import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { SessionEventRepository } from '../session-event.repository';
import { SessionEvents } from '../../entity/session-events.entity';
import { SessionEventVisibilityType } from '../../enum/session-event-visibility-type.enum';
import { Pagination } from 'src/common/type/common.type';

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
    detectionType: 'SENTENCE_SIMILARITY' as any,
    visibilityType: SessionEventVisibilityType.ACTIVE,
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-01-01T10:00:00Z'),
  };

  beforeEach(async () => {
    queryBuilder = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    } as any;

    const mockEntityManager = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    const mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue(mockEntityManager),
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
        pagination,
      );

      expect(repository.createQueryBuilder).toHaveBeenCalledWith(
        'sessionEvent',
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
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
  });
});
