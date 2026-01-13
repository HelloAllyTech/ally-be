import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ReviewService } from '../review.service';
import { ReviewRepository } from '../../repository/review.repository';
import { ReviewThreadRepository } from '../../repository/review-thread.repository';
import { ReviewCommentRepository } from '../../repository/review-comment.repository';
import { ReviewCommentReactionRepository } from '../../repository/review-comment-reaction.repository';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { UserService } from 'src/user/service/user.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { CreateReviewDto } from '../../dto/create-review.dto';
import { Review } from '../../entity/review.entity';
import { ReviewThread } from '../../entity/review-thread.entity';
import { ReviewComment } from '../../entity/review-comment.entity';
import { ReviewCommentReaction } from '../../entity/review-comment-reaction.entity';
import { User } from 'src/user/entity/user.entity';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: jest.fn(),
    getTenantId: jest.fn(),
  },
}));

describe('ReviewService', () => {
  let service: ReviewService;
  let reviewRepository: jest.Mocked<ReviewRepository>;
  let reviewThreadRepository: jest.Mocked<ReviewThreadRepository>;
  let reviewCommentRepository: jest.Mocked<ReviewCommentRepository>;
  let reviewCommentReactionRepository: jest.Mocked<ReviewCommentReactionRepository>;
  let scenarioSharedService: jest.Mocked<ScenarioSharedService>;
  let userService: jest.Mocked<UserService>;

  const mockUserId = '123';
  const mockTenantId = 'test-tenant';
  const mockScenarioSessionId = '123e4567-e89b-12d3-a456-426614174000';
  const mockReviewId = 'review-id-123';

  const mockReview: Review = {
    id: mockReviewId,
    scenarioSessionId: mockScenarioSessionId,
    createdBy: Number(mockUserId),
    status: 'IN_REVIEW' as any,
    tenantId: mockTenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Review;

  const mockScenarioSession = {
    id: mockScenarioSessionId,
    scenarioId: 'scenario-id',
  };

  const mockUser: User = {
    id: 1,
    name: 'Test User',
    email: 'test@example.com',
    profileImageUrl: 'https://example.com/image.jpg',
    tenantId: mockTenantId,
  } as User;

  beforeEach(async () => {
    const mockReviewRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
    };

    const mockReviewThreadRepository = {
      find: jest.fn(),
    };

    const mockReviewCommentRepository = {
      find: jest.fn(),
    };

    const mockReviewCommentReactionRepository = {
      find: jest.fn(),
    };

    const mockScenarioSharedService = {
      getScenarioSessionById: jest.fn(),
    };

    const mockUserService = {
      getUsersByIds: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewService,
        {
          provide: ReviewRepository,
          useValue: mockReviewRepository,
        },
        {
          provide: ReviewThreadRepository,
          useValue: mockReviewThreadRepository,
        },
        {
          provide: ReviewCommentRepository,
          useValue: mockReviewCommentRepository,
        },
        {
          provide: ReviewCommentReactionRepository,
          useValue: mockReviewCommentReactionRepository,
        },
        {
          provide: ScenarioSharedService,
          useValue: mockScenarioSharedService,
        },
        {
          provide: UserService,
          useValue: mockUserService,
        },
      ],
    }).compile();

    service = module.get<ReviewService>(ReviewService);
    reviewRepository = module.get(ReviewRepository);
    reviewThreadRepository = module.get(ReviewThreadRepository);
    reviewCommentRepository = module.get(ReviewCommentRepository);
    reviewCommentReactionRepository = module.get(
      ReviewCommentReactionRepository,
    );
    scenarioSharedService = module.get(ScenarioSharedService);
    userService = module.get(UserService);

    // Set default mocks for ExecutionManager
    (ExecutionManager.getUserId as jest.Mock).mockReturnValue(mockUserId);
    (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createReview', () => {
    const createReviewDto: CreateReviewDto = {
      scenarioSessionId: mockScenarioSessionId,
    };

    it('should create a review successfully', async () => {
      scenarioSharedService.getScenarioSessionById.mockResolvedValue(
        mockScenarioSession as any,
      );
      reviewRepository.findOne.mockResolvedValue(null);
      reviewRepository.create.mockReturnValue(mockReview);
      reviewRepository.save.mockResolvedValue(mockReview);

      const result = await service.createReview(createReviewDto);

      expect(ExecutionManager.getUserId).toHaveBeenCalled();
      expect(ExecutionManager.getTenantId).toHaveBeenCalled();
      expect(scenarioSharedService.getScenarioSessionById).toHaveBeenCalledWith(
        mockScenarioSessionId,
      );
      expect(reviewRepository.findOne).toHaveBeenCalledWith({
        where: {
          scenarioSessionId: mockScenarioSessionId,
        },
      });
      expect(reviewRepository.create).toHaveBeenCalledWith({
        ...createReviewDto,
        createdBy: Number(mockUserId),
        tenantId: mockTenantId,
      });
      expect(reviewRepository.save).toHaveBeenCalledWith(mockReview);
      expect(result).toEqual({ id: mockReviewId });
    });

    it('should throw BadRequestException when userId is not found', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(null);

      await expect(service.createReview(createReviewDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createReview(createReviewDto)).rejects.toThrow(
        'User or tenant not found',
      );
      expect(
        scenarioSharedService.getScenarioSessionById,
      ).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when tenantId is not found', async () => {
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(null);

      await expect(service.createReview(createReviewDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createReview(createReviewDto)).rejects.toThrow(
        'Tenant not found',
      );
      expect(
        scenarioSharedService.getScenarioSessionById,
      ).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when scenario session is not found', async () => {
      scenarioSharedService.getScenarioSessionById.mockResolvedValue(null);

      await expect(service.createReview(createReviewDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createReview(createReviewDto)).rejects.toThrow(
        'Scenario session not found',
      );
      expect(scenarioSharedService.getScenarioSessionById).toHaveBeenCalledWith(
        mockScenarioSessionId,
      );
      expect(reviewRepository.findOne).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when review already exists', async () => {
      scenarioSharedService.getScenarioSessionById.mockResolvedValue(
        mockScenarioSession as any,
      );
      reviewRepository.findOne.mockResolvedValue(mockReview);

      await expect(service.createReview(createReviewDto)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.createReview(createReviewDto)).rejects.toThrow(
        'Review already exists',
      );
      expect(reviewRepository.findOne).toHaveBeenCalledWith({
        where: {
          scenarioSessionId: mockScenarioSessionId,
        },
      });
      expect(reviewRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('getReviewThreads', () => {
    const mockReviewThread: ReviewThread = {
      id: 'thread-id-1',
      reviewId: mockReviewId,
      messageId: 1,
      createdBy: 1,
      selection: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ReviewThread;

    const mockReviewComment: ReviewComment = {
      id: 'comment-id-1',
      reviewThreadId: 'thread-id-1',
      content: 'Test comment',
      createdBy: 1,
      parentCommentId: undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ReviewComment;

    const mockReviewCommentReaction: ReviewCommentReaction = {
      id: 'reaction-id-1',
      reviewCommentId: 'comment-id-1',
      reaction: 'thumbsUp',
      createdBy: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ReviewCommentReaction;

    it('should return review threads with comments and reactions', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview);
      reviewThreadRepository.find.mockResolvedValue([mockReviewThread]);
      reviewCommentRepository.find.mockResolvedValue([mockReviewComment]);
      reviewCommentReactionRepository.find.mockResolvedValue([
        mockReviewCommentReaction,
      ]);
      userService.getUsersByIds.mockResolvedValue([mockUser]);

      const result = await service.getReviewThreads(mockReviewId);

      expect(reviewRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockReviewId },
      });
      expect(reviewThreadRepository.find).toHaveBeenCalledWith({
        where: { reviewId: mockReviewId },
      });
      expect(reviewCommentRepository.find).toHaveBeenCalled();
      expect(userService.getUsersByIds).toHaveBeenCalledWith([1]);
      expect(reviewCommentReactionRepository.find).toHaveBeenCalled();
      expect(result.count).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('thread-id-1');
      expect(result.data[0].commentCount).toBe(1);
      expect(result.data[0].comments).toHaveLength(1);
      expect(result.data[0].comments![0].id).toBe('comment-id-1');
      expect(result.data[0].comments![0].content).toBe('Test comment');
      expect(result.data[0].comments![0].createdBy.id).toBe(1);
      expect(result.data[0].comments![0].createdBy.name).toBe('Test User');
      expect(result.data[0].comments![0].createdBy.profileImage).toBe(
        'https://example.com/image.jpg',
      );
      expect(result.data[0].comments![0].reactions).toEqual({ thumbsUp: 1 });
      expect(result.data[0].comments![0].replyCount).toBe(0);
    });

    it('should throw NotFoundException when review is not found', async () => {
      reviewRepository.findOne.mockResolvedValue(null);

      await expect(service.getReviewThreads(mockReviewId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getReviewThreads(mockReviewId)).rejects.toThrow(
        'Review not found',
      );
      expect(reviewRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockReviewId },
      });
      expect(reviewThreadRepository.find).not.toHaveBeenCalled();
    });

    it('should return empty threads when no threads exist', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview);
      reviewThreadRepository.find.mockResolvedValue([]);
      reviewCommentRepository.find.mockResolvedValue([]);
      reviewCommentReactionRepository.find.mockResolvedValue([]);
      userService.getUsersByIds.mockResolvedValue([]);

      const result = await service.getReviewThreads(mockReviewId);

      expect(result.count).toBe(0);
      expect(result.data).toHaveLength(0);
      expect(reviewThreadRepository.find).toHaveBeenCalledWith({
        where: { reviewId: mockReviewId },
      });
    });

    it('should handle threads with no comments', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview);
      reviewThreadRepository.find.mockResolvedValue([mockReviewThread]);
      reviewCommentRepository.find.mockResolvedValue([]);
      reviewCommentReactionRepository.find.mockResolvedValue([]);
      userService.getUsersByIds.mockResolvedValue([]);

      const result = await service.getReviewThreads(mockReviewId);

      expect(result.count).toBe(1);
      expect(result.data[0].commentCount).toBe(0);
      expect(result.data[0].comments).toHaveLength(0);
    });

    it('should handle comments with multiple reactions', async () => {
      const reactions = [
        { ...mockReviewCommentReaction, reaction: 'thumbsUp' },
        {
          ...mockReviewCommentReaction,
          id: 'reaction-id-2',
          reaction: 'thumbsUp',
        },
        {
          ...mockReviewCommentReaction,
          id: 'reaction-id-3',
          reaction: 'heart',
        },
      ];

      reviewRepository.findOne.mockResolvedValue(mockReview);
      reviewThreadRepository.find.mockResolvedValue([mockReviewThread]);
      reviewCommentRepository.find.mockResolvedValue([mockReviewComment]);
      reviewCommentReactionRepository.find.mockResolvedValue(reactions);
      userService.getUsersByIds.mockResolvedValue([mockUser]);

      const result = await service.getReviewThreads(mockReviewId);

      expect(result.data[0].comments![0].reactions).toEqual({
        thumbsUp: 2,
        heart: 1,
      });
    });

    it('should handle comments with replies - exclude replies from response', async () => {
      const replyComment: ReviewComment = {
        ...mockReviewComment,
        id: 'comment-id-2',
        parentCommentId: 'comment-id-1',
      } as ReviewComment;

      reviewRepository.findOne.mockResolvedValue(mockReview);
      reviewThreadRepository.find.mockResolvedValue([mockReviewThread]);
      reviewCommentRepository.find.mockResolvedValue([
        mockReviewComment,
        replyComment,
      ]);
      reviewCommentReactionRepository.find.mockResolvedValue([]);
      userService.getUsersByIds.mockResolvedValue([mockUser]);

      const result = await service.getReviewThreads(mockReviewId);

      // Only top-level comment should be in the response
      expect(result.data[0].comments).toHaveLength(1);
      expect(result.data[0].comments![0].id).toBe('comment-id-1');
      // Reply count should still be calculated correctly
      expect(result.data[0].comments![0].replyCount).toBe(1);
      // Comment count should only count top-level comments
      expect(result.data[0].commentCount).toBe(1);
    });

    it('should exclude multiple replies and only return top-level comments', async () => {
      const replyComment1: ReviewComment = {
        ...mockReviewComment,
        id: 'comment-id-2',
        parentCommentId: 'comment-id-1',
      } as ReviewComment;

      const replyComment2: ReviewComment = {
        ...mockReviewComment,
        id: 'comment-id-3',
        parentCommentId: 'comment-id-1',
      } as ReviewComment;

      const topLevelComment2: ReviewComment = {
        ...mockReviewComment,
        id: 'comment-id-4',
        parentCommentId: undefined,
      } as ReviewComment;

      reviewRepository.findOne.mockResolvedValue(mockReview);
      reviewThreadRepository.find.mockResolvedValue([mockReviewThread]);
      reviewCommentRepository.find.mockResolvedValue([
        mockReviewComment,
        replyComment1,
        replyComment2,
        topLevelComment2,
      ]);
      reviewCommentReactionRepository.find.mockResolvedValue([]);
      userService.getUsersByIds.mockResolvedValue([mockUser]);

      const result = await service.getReviewThreads(mockReviewId);

      // Should only return 2 top-level comments (not the replies)
      expect(result.data[0].comments).toHaveLength(2);
      expect(result.data[0].commentCount).toBe(2);
      // First comment should have 2 replies
      expect(result.data[0].comments![0].replyCount).toBe(2);
      // Second comment should have 0 replies
      expect(result.data[0].comments![1].replyCount).toBe(0);
      // Verify reply comments are not in the response
      const commentIds = result.data[0].comments!.map((c) => c.id);
      expect(commentIds).not.toContain('comment-id-2');
      expect(commentIds).not.toContain('comment-id-3');
      expect(commentIds).toContain('comment-id-1');
      expect(commentIds).toContain('comment-id-4');
    });

    it('should handle comments with missing user data', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview);
      reviewThreadRepository.find.mockResolvedValue([mockReviewThread]);
      reviewCommentRepository.find.mockResolvedValue([mockReviewComment]);
      reviewCommentReactionRepository.find.mockResolvedValue([]);
      userService.getUsersByIds.mockResolvedValue([]);

      const result = await service.getReviewThreads(mockReviewId);

      expect(result.data[0].comments![0].createdBy.id).toBe(1);
      expect(result.data[0].comments![0].createdBy.name).toBeUndefined();
      expect(
        result.data[0].comments![0].createdBy.profileImage,
      ).toBeUndefined();
    });

    it('should handle comments with no reactions', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview);
      reviewThreadRepository.find.mockResolvedValue([mockReviewThread]);
      reviewCommentRepository.find.mockResolvedValue([mockReviewComment]);
      reviewCommentReactionRepository.find.mockResolvedValue([]);
      userService.getUsersByIds.mockResolvedValue([mockUser]);

      const result = await service.getReviewThreads(mockReviewId);

      expect(result.data[0].comments![0].reactions).toBeUndefined();
    });

    it('should handle multiple threads with comments', async () => {
      const thread2: ReviewThread = {
        ...mockReviewThread,
        id: 'thread-id-2',
      } as ReviewThread;

      const comment2: ReviewComment = {
        ...mockReviewComment,
        id: 'comment-id-2',
        reviewThreadId: 'thread-id-2',
      } as ReviewComment;

      reviewRepository.findOne.mockResolvedValue(mockReview);
      reviewThreadRepository.find.mockResolvedValue([
        mockReviewThread,
        thread2,
      ]);
      reviewCommentRepository.find.mockResolvedValue([
        mockReviewComment,
        comment2,
      ]);
      reviewCommentReactionRepository.find.mockResolvedValue([]);
      userService.getUsersByIds.mockResolvedValue([mockUser]);

      const result = await service.getReviewThreads(mockReviewId);

      expect(result.count).toBe(2);
      expect(result.data[0].commentCount).toBe(1);
      expect(result.data[1].commentCount).toBe(1);
      expect(result.data[0].id).toBe('thread-id-1');
      expect(result.data[1].id).toBe('thread-id-2');
    });
  });
});
