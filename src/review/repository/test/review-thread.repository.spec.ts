import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ReviewThread } from '../../entity/review-thread.entity';
import { Pagination } from 'src/common/type/common.type';
import { ReviewThreadRepository } from '../review-thread.repository';

describe('ReviewThreadRepository', () => {
  let repository: ReviewThreadRepository;
  let mockQueryBuilder: any;

  beforeEach(async () => {
    // Create mock query builder with proper Jest mock functions
    mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getCount: jest.fn(),
      getMany: jest.fn(),
    };

    const mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewThreadRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<ReviewThreadRepository>(ReviewThreadRepository);

    // Mock createQueryBuilder on repository instance
    jest
      .spyOn(repository, 'createQueryBuilder')
      .mockReturnValue(mockQueryBuilder);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('getReviewThreadsByReviewId', () => {
    const mockReviewId = '123e4567-e89b-12d3-a456-426614174000';

    const mockReviewThreads: ReviewThread[] = [
      {
        id: 'thread-id-1',
        reviewId: mockReviewId,
        messageId: 1,
        createdBy: 1,
        selection: { start: 0, end: 10 },
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      } as ReviewThread,
      {
        id: 'thread-id-2',
        reviewId: mockReviewId,
        messageId: 2,
        createdBy: 2,
        selection: { start: 5, end: 15 },
        createdAt: new Date('2024-01-02'),
        updatedAt: new Date('2024-01-02'),
      } as ReviewThread,
    ];

    it('should apply limit when provided in options', async () => {
      const options: Pagination = {
        limit: 10,
      };

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(2);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(
        mockReviewThreads,
      );

      const result = await repository.getReviewThreadsByReviewId(
        mockReviewId,
        options,
      );

      expect(result).toEqual({
        threads: mockReviewThreads,
        count: 2,
      });
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
    });

    it('should apply offset when provided in options', async () => {
      const options: Pagination = {
        offset: 5,
      };

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(2);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(
        mockReviewThreads,
      );

      const result = await repository.getReviewThreadsByReviewId(
        mockReviewId,
        options,
      );

      expect(result).toEqual({
        threads: mockReviewThreads,
        count: 2,
      });
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(5);
      expect(mockQueryBuilder.limit).not.toHaveBeenCalled();
    });

    it('should apply both limit and offset when provided in options', async () => {
      const options: Pagination = {
        limit: 10,
        offset: 5,
      };

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(20);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(
        mockReviewThreads,
      );

      const result = await repository.getReviewThreadsByReviewId(
        mockReviewId,
        options,
      );

      expect(result).toEqual({
        threads: mockReviewThreads,
        count: 20,
      });
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(5);
    });

    it('should return empty array when no threads exist for review', async () => {
      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(0);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      const result = await repository.getReviewThreadsByReviewId(mockReviewId);

      expect(result).toEqual({
        threads: [],
        count: 0,
      });
      expect(mockQueryBuilder.getCount).toHaveBeenCalled();
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
    });

    it('should return correct count even when pagination limits results', async () => {
      const options: Pagination = {
        limit: 1,
        offset: 0,
      };

      const singleThread = [mockReviewThreads[0]];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(2);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(singleThread);

      const result = await repository.getReviewThreadsByReviewId(
        mockReviewId,
        options,
      );

      expect(result).toEqual({
        threads: singleThread,
        count: 2, // Total count, not paginated count
      });
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(1);
    });

    it('should handle different review IDs correctly', async () => {
      const differentReviewId = '987e6543-e21b-34d5-c678-901234567890';

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([
        mockReviewThreads[0],
      ]);

      await repository.getReviewThreadsByReviewId(differentReviewId);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'reviewThread.reviewId = :reviewId',
        { reviewId: differentReviewId },
      );
    });

    it('should get count before applying pagination', async () => {
      const options: Pagination = {
        limit: 5,
        offset: 10,
      };

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(50);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(
        mockReviewThreads,
      );

      await repository.getReviewThreadsByReviewId(mockReviewId, options);

      // Verify getCount is called before limit/offset
      const callOrder = [
        mockQueryBuilder.where.mock.invocationCallOrder[0],
        mockQueryBuilder.getCount.mock.invocationCallOrder[0],
        mockQueryBuilder.limit.mock.invocationCallOrder[0],
        mockQueryBuilder.offset.mock.invocationCallOrder[0],
        mockQueryBuilder.getMany.mock.invocationCallOrder[0],
      ];

      expect(callOrder[1]).toBeLessThan(callOrder[2]); // getCount before limit
      expect(callOrder[1]).toBeLessThan(callOrder[3]); // getCount before offset
      expect(callOrder[1]).toBeLessThan(callOrder[4]); // getCount before getMany
    });
  });
});
