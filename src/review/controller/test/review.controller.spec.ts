import { Test, TestingModule } from '@nestjs/testing';
import { ReviewController } from '../review.controller';
import { ReviewService } from '../../service/review.service';
import {
  CreateReviewDto,
  CreateReviewResponseDto,
} from '../../dto/create-review.dto';
import { ReviewThreadsResponseDto } from '../../dto/review-threads.dto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

jest.mock('../../../auth/decorators/auth-permissions.decorator', () => ({
  AuthPermissions: () => () => {},
}));

describe('ReviewController', () => {
  let controller: ReviewController;
  let reviewService: jest.Mocked<ReviewService>;

  const mockReviewService = {
    createReview: jest.fn(),
    getReviewThreads: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReviewController],
      providers: [
        {
          provide: ReviewService,
          useValue: mockReviewService,
        },
      ],
    }).compile();

    controller = module.get<ReviewController>(ReviewController);
    reviewService = module.get(ReviewService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createReview', () => {
    const mockCreateReviewDto: CreateReviewDto = {
      scenarioSessionId: '123e4567-e89b-12d3-a456-426614174000',
    };

    const mockCreateReviewResponse: CreateReviewResponseDto = {
      id: 'review-id-123',
    };

    it('should create a review successfully', async () => {
      reviewService.createReview.mockResolvedValue(mockCreateReviewResponse);

      const result = await controller.createReview(mockCreateReviewDto);

      expect(reviewService.createReview).toHaveBeenCalledWith(
        mockCreateReviewDto,
      );
      expect(reviewService.createReview).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockCreateReviewResponse);
      expect(result.id).toBe('review-id-123');
    });

    it('should throw BadRequestException when service throws BadRequestException', async () => {
      const error = new BadRequestException('User or tenant not found');
      reviewService.createReview.mockRejectedValue(error);

      await expect(
        controller.createReview(mockCreateReviewDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.createReview(mockCreateReviewDto),
      ).rejects.toThrow('User or tenant not found');
      expect(reviewService.createReview).toHaveBeenCalledWith(
        mockCreateReviewDto,
      );
    });

    it('should throw ConflictException when review already exists', async () => {
      const error = new ConflictException('Review already exists');
      reviewService.createReview.mockRejectedValue(error);

      await expect(
        controller.createReview(mockCreateReviewDto),
      ).rejects.toThrow(ConflictException);
      await expect(
        controller.createReview(mockCreateReviewDto),
      ).rejects.toThrow('Review already exists');
      expect(reviewService.createReview).toHaveBeenCalledWith(
        mockCreateReviewDto,
      );
    });
  });

  describe('getReviewThreads', () => {
    const mockReviewId = '123e4567-e89b-12d3-a456-426614174000';

    const mockReviewThreadsResponse: ReviewThreadsResponseDto = {
      data: [
        {
          id: 'thread-id-1',
          comments: [
            {
              id: 'comment-id-1',
              content: 'Test comment',
              createdAt: new Date('2023-01-01'),
              createdBy: {
                id: 1,
                name: 'Test User',
                profileImage: 'https://example.com/image.jpg',
              },
              reactions: {
                thumbsUp: 5,
                heart: 3,
              },
              replyCount: 2,
            },
          ],
          commentCount: 1,
        },
      ],
      count: 1,
    };

    it('should return review threads successfully', async () => {
      reviewService.getReviewThreads.mockResolvedValue(
        mockReviewThreadsResponse,
      );

      const result = await controller.getReviewThreads(mockReviewId);

      expect(reviewService.getReviewThreads).toHaveBeenCalledWith(mockReviewId);
      expect(reviewService.getReviewThreads).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockReviewThreadsResponse);
      expect(result.count).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('thread-id-1');
    });

    it('should return empty threads when no threads exist', async () => {
      const emptyResponse: ReviewThreadsResponseDto = {
        data: [],
        count: 0,
      };
      reviewService.getReviewThreads.mockResolvedValue(emptyResponse);

      const result = await controller.getReviewThreads(mockReviewId);

      expect(reviewService.getReviewThreads).toHaveBeenCalledWith(mockReviewId);
      expect(result).toEqual(emptyResponse);
      expect(result.count).toBe(0);
      expect(result.data).toHaveLength(0);
    });

    it('should throw NotFoundException when review is not found', async () => {
      const error = new NotFoundException('Review not found');
      reviewService.getReviewThreads.mockRejectedValue(error);

      await expect(controller.getReviewThreads(mockReviewId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(controller.getReviewThreads(mockReviewId)).rejects.toThrow(
        'Review not found',
      );
      expect(reviewService.getReviewThreads).toHaveBeenCalledWith(mockReviewId);
    });
  });
});
