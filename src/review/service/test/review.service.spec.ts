import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ReviewService } from '../review.service';
import { ReviewRepository } from '../../repository/review.repository';
import { ReviewThreadRepository } from '../../repository/review-thread.repository';
import { ReviewReactionRepository } from '../../repository/review-reaction.repository';
import { ReviewCommentRepository } from '../../repository/review-comment.repository';
import { ReviewCommentReactionRepository } from '../../repository/review-comment-reaction.repository';
import { ReviewAccessValidator } from '../../util/review-access-policy.util';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { UserService } from 'src/user/service/user.service';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { ReviewStatus } from '../../type/review.type';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

jest.mock('src/common/execution/execution-manager');

describe('ReviewService', () => {
  let service: ReviewService;
  let reviewRepository: jest.Mocked<ReviewRepository>;
  let reviewThreadRepository: jest.Mocked<ReviewThreadRepository>;
  let reviewReactionRepository: jest.Mocked<ReviewReactionRepository>;
  let reviewCommentRepository: jest.Mocked<ReviewCommentRepository>;
  let reviewCommentReactionRepository: jest.Mocked<ReviewCommentReactionRepository>;
  let scenarioSharedService: jest.Mocked<ScenarioSharedService>;
  let userService: jest.Mocked<UserService>;
  let permissionValidator: jest.Mocked<PermissionValidator>;

  const mockUserId = 123;
  const mockTenantId = 'tenant-123';
  const mockScenarioSessionId = 'session-123';
  const mockReviewId = 'review-123';

  const mockReview = {
    id: mockReviewId,
    scenarioSessionId: mockScenarioSessionId,
    createdBy: mockUserId,
    tenantId: mockTenantId,
    status: ReviewStatus.IN_REVIEW,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockScenarioSession = {
    id: mockScenarioSessionId,
    scenarioId: 'scenario-123',
    startedAt: new Date('2024-01-01T10:00:00Z'),
    endedAt: new Date('2024-01-01T10:30:00Z'),
  };

  const mockScenario = {
    id: 'scenario-123',
    title: 'Test Scenario',
    description: 'Test Description',
    coverImageUrl: 'https://example.com/image.jpg',
    coverVideoUrl: 'https://example.com/video.mp4',
    createdAt: new Date(),
  };

  const mockUser = {
    id: mockUserId,
    name: 'Test User',
    profileImageUrl: 'https://example.com/profile.jpg',
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewService,
        {
          provide: ReviewRepository,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            getAllReviews: jest.fn(),
          },
        },
        {
          provide: ReviewThreadRepository,
          useValue: {
            getCommentsCountByReviewIds: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: ReviewReactionRepository,
          useValue: {
            getReactionsByReviewIds: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: ReviewCommentRepository,
          useValue: {
            getCommentsForThreadIds: jest.fn(),
          },
        },
        {
          provide: ReviewCommentReactionRepository,
          useValue: {
            getReactionAndCountByCommentIds: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: ScenarioSharedService,
          useValue: {
            getScenarioSessionForUser: jest.fn(),
            getScenarioSessionById: jest.fn(),
            getScenarioById: jest.fn(),
            getMessagesByScenarioSessionId: jest.fn(),
          },
        },
        {
          provide: UserService,
          useValue: {
            get: jest.fn(),
            getUsersByIds: jest.fn(),
          },
        },
        {
          provide: PermissionValidator,
          useValue: {
            validatePermissions: jest.fn(),
          },
        },
        {
          provide: ReviewAccessValidator,
          useValue: {
            validateAccess: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<ReviewService>(ReviewService);
    reviewRepository = module.get(ReviewRepository);
    reviewThreadRepository = module.get(ReviewThreadRepository);
    reviewReactionRepository = module.get(ReviewReactionRepository);
    reviewCommentRepository = module.get(ReviewCommentRepository);
    reviewCommentReactionRepository = module.get(
      ReviewCommentReactionRepository,
    );
    scenarioSharedService = module.get(ScenarioSharedService);
    userService = module.get(UserService);
    permissionValidator = module.get(PermissionValidator);

    reviewCommentRepository.getCommentsForThreadIds.mockResolvedValue([]);
    reviewCommentReactionRepository.getReactionAndCountByCommentIds.mockResolvedValue(
      [],
    );
    reviewCommentReactionRepository.find.mockResolvedValue([]);
    userService.getUsersByIds.mockResolvedValue([]);
  });

  describe('createReview', () => {
    const createReviewDto = {
      scenarioSessionId: mockScenarioSessionId,
    };

    beforeEach(() => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(
        String(mockUserId),
      );
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
    });

    it('should throw BadRequestException when scenario session not found', async () => {
      scenarioSharedService.getScenarioSessionForUser.mockResolvedValue(null);

      await expect(service.createReview(createReviewDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(reviewRepository.findOne).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when review already exists', async () => {
      scenarioSharedService.getScenarioSessionForUser.mockResolvedValue(
        mockScenarioSession as any,
      );
      reviewRepository.findOne.mockResolvedValue(mockReview);

      await expect(service.createReview(createReviewDto)).rejects.toThrow(
        ConflictException,
      );
      expect(reviewRepository.findOne).toHaveBeenCalledWith({
        where: { scenarioSessionId: mockScenarioSessionId },
      });
    });

    it('should successfully create review', async () => {
      scenarioSharedService.getScenarioSessionForUser.mockResolvedValue(
        mockScenarioSession as any,
      );
      reviewRepository.findOne.mockResolvedValue(null);
      reviewRepository.create.mockReturnValue(mockReview as any);
      reviewRepository.save.mockResolvedValue(mockReview as any);

      const result = await service.createReview(createReviewDto);

      expect(result).toEqual({ id: mockReviewId });
      expect(reviewRepository.create).toHaveBeenCalledWith({
        ...createReviewDto,
        createdBy: mockUserId,
        tenantId: mockTenantId,
      });
      expect(reviewRepository.save).toHaveBeenCalled();
    });
  });

  describe('updateReviewStatus', () => {
    const updateReviewStatusDto = {
      status: ReviewStatus.HIDDEN,
    };

    beforeEach(() => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(
        String(mockUserId),
      );
    });

    it('should throw BadRequestException when review not found', async () => {
      reviewRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateReviewStatus(mockReviewId, updateReviewStatusDto),
      ).rejects.toThrow(BadRequestException);
      expect(reviewRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockReviewId, createdBy: mockUserId },
      });
    });

    it('should throw BadRequestException when user does not own the review', async () => {
      reviewRepository.findOne.mockResolvedValue(null); // Not found because of createdBy filter

      await expect(
        service.updateReviewStatus(mockReviewId, updateReviewStatusDto),
      ).rejects.toThrow(BadRequestException);
      expect(reviewRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockReviewId, createdBy: mockUserId },
      });
    });

    it('should successfully update review status when user owns the review', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      const updatedReview = { ...mockReview, status: ReviewStatus.HIDDEN };
      reviewRepository.create.mockReturnValue(updatedReview as any);
      reviewRepository.save.mockResolvedValue(updatedReview as any);

      const result = await service.updateReviewStatus(
        mockReviewId,
        updateReviewStatusDto,
      );

      expect(result).toEqual({ success: true });
      expect(reviewRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockReviewId, createdBy: mockUserId },
      });
      expect(reviewRepository.create).toHaveBeenCalledWith({
        ...mockReview,
        status: ReviewStatus.HIDDEN,
      });
      expect(reviewRepository.save).toHaveBeenCalled();
    });
  });

  describe('getAllReviews', () => {
    const options = {
      limit: 10,
      offset: 0,
      sortBy: undefined,
      sortOrder: undefined,
    };

    beforeEach(() => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(
        String(mockUserId),
      );
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
    });

    it('should return empty array when no reviews found', async () => {
      reviewRepository.getAllReviews.mockResolvedValue({
        reviews: [],
        count: 0,
      });

      const result = await service.getAllReviews(options);

      expect(result.data).toEqual([]);
      expect(result.count).toBe(0);
      expect(
        reviewReactionRepository.getReactionsByReviewIds,
      ).not.toHaveBeenCalled();
      expect(
        reviewThreadRepository.getCommentsCountByReviewIds,
      ).not.toHaveBeenCalled();
    });

    it('should return formatted reviews with reactions and comments aggregated', async () => {
      const mockReviews = [
        {
          ...mockReview,
          scenario: mockScenario,
          scenarioSession: mockScenarioSession,
          createdBy: mockUser,
        },
      ];
      const mockReactions = [
        {
          reviewId: mockReviewId,
          reaction: 'like',
          count: 5,
        },
      ];
      const mockComments = [
        {
          reviewId: mockReviewId,
          count: 3,
        },
      ];

      reviewRepository.getAllReviews.mockResolvedValue({
        reviews: mockReviews as any,
        count: 1,
      });
      reviewReactionRepository.getReactionsByReviewIds.mockResolvedValue(
        mockReactions as any,
      );
      reviewThreadRepository.getCommentsCountByReviewIds.mockResolvedValue(
        mockComments as any,
      );

      const result = await service.getAllReviews(options);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: mockReviewId,
        commentsCount: 3,
        reactions: { like: 5 },
        createdBy: {
          id: mockUserId,
          name: mockUser.name,
          profileImage: mockUser.profileImageUrl,
        },
      });
      expect(result.count).toBe(1);
    });
  });

  describe('getReviewById', () => {
    beforeEach(() => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(
        String(mockUserId),
      );
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
    });

    it('should throw BadRequestException when scenario session not found', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      scenarioSharedService.getScenarioSessionById.mockResolvedValue(null);

      await expect(service.getReviewById(mockReviewId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should successfully return review when user is the creator of a HIDDEN review', async () => {
      const hiddenReview = {
        ...mockReview,
        status: ReviewStatus.HIDDEN,
        createdBy: mockUserId,
      };
      reviewRepository.findOne.mockResolvedValue(hiddenReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      scenarioSharedService.getScenarioSessionById.mockResolvedValue(
        mockScenarioSession as any,
      );
      scenarioSharedService.getScenarioById.mockResolvedValue(
        mockScenario as any,
      );
      userService.get.mockResolvedValue(mockUser as any);
      reviewThreadRepository.getCommentsCountByReviewIds.mockResolvedValue([
        { reviewId: mockReviewId, count: 5 },
      ] as any);
      reviewReactionRepository.getReactionsByReviewIds.mockResolvedValue(
        [] as any,
      );
      reviewReactionRepository.findOne.mockResolvedValue(null as any);

      const result = await service.getReviewById(mockReviewId);

      expect(result).toMatchObject({
        id: mockReviewId,
        commentsCount: 5,
      });
    });

    it('should successfully return review when reviewer accesses review from same tenant', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockImplementation(
        async (userId, permissions) => {
          return permissions.includes(PERMISSIONS.REVIEWER_ACCESS);
        },
      );
      scenarioSharedService.getScenarioSessionById.mockResolvedValue(
        mockScenarioSession as any,
      );
      scenarioSharedService.getScenarioById.mockResolvedValue(
        mockScenario as any,
      );
      userService.get.mockResolvedValue(mockUser as any);
      reviewThreadRepository.getCommentsCountByReviewIds.mockResolvedValue([
        { reviewId: mockReviewId, count: 5 },
      ] as any);
      reviewReactionRepository.getReactionsByReviewIds.mockResolvedValue(
        [] as any,
      );
      reviewReactionRepository.findOne.mockResolvedValue(null as any);

      const result = await service.getReviewById(mockReviewId);

      expect(result).toMatchObject({
        id: mockReviewId,
        commentsCount: 5,
      });
    });

    it('should successfully return review when learner accesses their own review', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockImplementation(
        async (userId, permissions) => {
          if (permissions.includes(PERMISSIONS.REVIEWER_ACCESS)) {
            return false;
          }
          if (permissions.includes(PERMISSIONS.LEARNER_ACCESS)) {
            return true;
          }
          return false;
        },
      );
      scenarioSharedService.getScenarioSessionById.mockResolvedValue(
        mockScenarioSession as any,
      );
      scenarioSharedService.getScenarioById.mockResolvedValue(
        mockScenario as any,
      );
      userService.get.mockResolvedValue(mockUser as any);
      reviewThreadRepository.getCommentsCountByReviewIds.mockResolvedValue([
        { reviewId: mockReviewId, count: 5 },
      ] as any);
      reviewReactionRepository.getReactionsByReviewIds.mockResolvedValue(
        [] as any,
      );
      reviewReactionRepository.findOne.mockResolvedValue(null as any);

      const result = await service.getReviewById(mockReviewId);

      expect(result).toMatchObject({
        id: mockReviewId,
        commentsCount: 5,
      });
    });

    it('should successfully return review details', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      scenarioSharedService.getScenarioSessionById.mockResolvedValue(
        mockScenarioSession as any,
      );
      scenarioSharedService.getScenarioById.mockResolvedValue(
        mockScenario as any,
      );
      userService.get.mockResolvedValue(mockUser as any);
      reviewThreadRepository.getCommentsCountByReviewIds.mockResolvedValue([
        { reviewId: mockReviewId, count: 5 },
      ] as any);
      reviewReactionRepository.getReactionsByReviewIds.mockResolvedValue(
        [] as any,
      );
      reviewReactionRepository.findOne.mockResolvedValue(null as any);

      const result = await service.getReviewById(mockReviewId);

      expect(result).toMatchObject({
        id: mockReviewId,
        scenario: {
          title: mockScenario.title,
          createdAt: mockScenario.createdAt,
          description: mockScenario.description,
          coverImageUrl: mockScenario.coverImageUrl,
          coverVideoUrl: mockScenario.coverVideoUrl,
        },
        commentsCount: 5,
        createdBy: {
          id: mockUserId,
          name: mockUser.name,
          profileImage: mockUser.profileImageUrl,
        },
      });
    });
  });

  describe('getReviewMessages', () => {
    const mockOptions = { limit: 10, offset: 0 };
    const mockMessageId = 1;
    const mockThreadId = 'thread-123';
    const mockCommentId = 'comment-123';

    const mockMessage = {
      id: mockMessageId,
      content: 'Test message',
      createdAt: new Date(),
      startSeconds: 0,
      endSeconds: 5,
      senderId: mockUserId,
    };

    const mockThread = {
      id: mockThreadId,
      reviewId: mockReviewId,
      messageId: mockMessageId,
      createdBy: mockUserId,
      selection: { startIndex: 0, endIndex: 10 },
    };

    const mockComment = {
      comment_id: mockCommentId,
      comment_reviewThreadId: mockThreadId,
      comment_content: 'Test comment',
      comment_createdAt: new Date(),
      comment_createdBy: mockUserId,
      comment_hidden: false,
      reply_count: '0',
      row_num: 1,
    };

    beforeEach(() => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(
        String(mockUserId),
      );
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
    });

    it('should return empty array when no messages found', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      scenarioSharedService.getMessagesByScenarioSessionId.mockResolvedValue({
        messages: [],
        count: 0,
      } as any);

      const result = await service.getReviewMessages(mockReviewId, mockOptions);

      expect(result.data).toEqual([]);
      expect(result.count).toBe(0);
    });

    it('should return messages with empty threads when no threads found', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      scenarioSharedService.getMessagesByScenarioSessionId.mockResolvedValue({
        messages: [mockMessage],
        count: 1,
      } as any);
      reviewThreadRepository.find.mockResolvedValue([]);
      reviewCommentRepository.getCommentsForThreadIds.mockResolvedValue([]);

      const result = await service.getReviewMessages(mockReviewId, mockOptions);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: mockMessageId,
        content: mockMessage.content,
        threads: [],
      });
      expect(result.count).toBe(1);
    });

    it('should return messages with threads and comments when data exists', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      scenarioSharedService.getMessagesByScenarioSessionId.mockResolvedValue({
        messages: [mockMessage],
        count: 1,
      } as any);
      reviewThreadRepository.find.mockResolvedValue([mockThread] as any);
      reviewCommentRepository.getCommentsForThreadIds.mockResolvedValue([
        mockComment,
      ] as any);
      reviewCommentReactionRepository.getReactionAndCountByCommentIds.mockResolvedValue(
        [] as any,
      );
      reviewCommentReactionRepository.find.mockResolvedValue([] as any);
      userService.getUsersByIds.mockResolvedValue([mockUser] as any);

      const result = await service.getReviewMessages(mockReviewId, mockOptions);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].threads).toHaveLength(1);
      expect(result.data[0].threads?.[0]).toMatchObject({
        id: mockThreadId,
        selection: mockThread.selection,
      });
      expect(result.data[0].threads?.[0]?.comments).toHaveLength(1);
      expect(result.data[0].threads?.[0]?.comments?.[0]).toMatchObject({
        id: mockCommentId,
        content: mockComment.comment_content,
      });
    });
  });
});
