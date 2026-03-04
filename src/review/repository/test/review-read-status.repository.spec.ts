import { Test, TestingModule } from '@nestjs/testing';
import { ReviewReadStatusRepository } from '../review-read-status.repository';
import { DataSource } from 'typeorm';

const mockQueryBuilder = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  subQuery: jest.fn().mockReturnThis(),
  getQuery: jest
    .fn()
    .mockReturnValue(
      '(SELECT rrs.reviewId FROM review_read_status rrs WHERE rrs.userId = :userId)',
    ),
  getRawOne: jest.fn().mockResolvedValue({ count: '3' }),
};

const mockDataSource = {
  createEntityManager: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
};

describe('ReviewReadStatusRepository', () => {
  let repository: ReviewReadStatusRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewReadStatusRepository,
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    repository = module.get<ReviewReadStatusRepository>(
      ReviewReadStatusRepository,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('getUnreadCount', () => {
    it('should return the unread count', async () => {
      const result = await repository.getUnreadCount(1, 'tenant-1');
      expect(result).toBe(3);
      expect(mockDataSource.createQueryBuilder).toHaveBeenCalled();
    });

    it('should return 0 when no unread reviews', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValueOnce({ count: '0' });
      const result = await repository.getUnreadCount(1, 'tenant-1');
      expect(result).toBe(0);
    });

    it('should return 0 when result is null', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValueOnce(null);
      const result = await repository.getUnreadCount(1, 'tenant-1');
      expect(result).toBe(0);
    });
  });

  describe('markAsRead', () => {
    it('should call upsert with correct parameters', async () => {
      repository.upsert = jest.fn().mockResolvedValue(undefined);
      await repository.markAsRead(1, 'review-uuid-1');
      expect(repository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          reviewId: 'review-uuid-1',
          readAt: expect.any(Date),
        }),
        ['userId', 'reviewId'],
      );
    });
  });
});
