import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ReviewService } from '../review.service';
import { ReviewRepository } from '../../repository/review.repository';
import { ReviewThreadRepository } from '../../repository/review-thread.repository';
import { ReviewReactionRepository } from '../../repository/review-reaction.repository';
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
          },
        },
        {
          provide: ReviewReactionRepository,
          useValue: {
            getReactionsByReviewIds: jest.fn(),
          },
        },
        {
          provide: ScenarioSharedService,
          useValue: {
            getScenarioSessionForUser: jest.fn(),
            getScenarioSessionById: jest.fn(),
            getScenarioById: jest.fn(),
          },
        },
        {
          provide: UserService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: PermissionValidator,
          useValue: {
            validatePermissions: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ReviewService>(ReviewService);
    reviewRepository = module.get(ReviewRepository);
    reviewThreadRepository = module.get(ReviewThreadRepository);
    reviewReactionRepository = module.get(ReviewReactionRepository);
    scenarioSharedService = module.get(ScenarioSharedService);
    userService = module.get(UserService);
    permissionValidator = module.get(PermissionValidator);
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
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
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

    it('should throw ForbiddenException when review is HIDDEN and user is not creator', async () => {
      const hiddenReview = {
        ...mockReview,
        status: ReviewStatus.HIDDEN,
        createdBy: 999, // Different user
      };
      reviewRepository.findOne.mockResolvedValue(hiddenReview as any);

      await expect(service.getReviewById(mockReviewId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException when reviewer tries to access review from different tenant', async () => {
      const differentTenantReview = {
        ...mockReview,
        tenantId: 'different-tenant',
      };
      reviewRepository.findOne.mockResolvedValue(differentTenantReview as any);
      (permissionValidator.validatePermissions as jest.Mock).mockImplementation(
        async (userId, permissions) => {
          if (permissions.includes(PERMISSIONS.REVIEWER_ACCESS)) {
            return true;
          }
          return false;
        },
      );

      await expect(service.getReviewById(mockReviewId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException when learner tries to access review they did not create', async () => {
      const otherUserReview = {
        ...mockReview,
        createdBy: 999,
      };
      reviewRepository.findOne.mockResolvedValue(otherUserReview as any);
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

      await expect(service.getReviewById(mockReviewId)).rejects.toThrow(
        ForbiddenException,
      );
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

      const result = await service.getReviewById(mockReviewId);

      expect(result).toMatchObject({
        id: mockReviewId,
        scenario: {
          title: mockScenario.title,
          createdAt: mockScenario.createdAt,
          duration: 1800, // 30 minutes in seconds
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
});
