import { Test, TestingModule } from '@nestjs/testing';
import { ReviewSharedService } from '../review-shared.service';
import { ReviewRepository } from '../../repository/review.repository';
import { ReviewReactionRepository } from '../../repository/review-reaction.repository';
import { ReviewCommentRepository } from '../../repository/review-comment.repository';
import { ReviewCommentReactionRepository } from '../../repository/review-comment-reaction.repository';

describe('ReviewSharedService', () => {
  let service: ReviewSharedService;
  let reviewRepository: jest.Mocked<ReviewRepository>;
  let reviewReactionRepository: jest.Mocked<ReviewReactionRepository>;
  let reviewCommentRepository: jest.Mocked<ReviewCommentRepository>;
  let reviewCommentReactionRepository: jest.Mocked<ReviewCommentReactionRepository>;

  const mockScenarioSessionId = 'session-123';
  const mockReviewId = 'review-123';
  const mockTenantIds = ['tenant-1', 'tenant-2'];
  const mockUserIds = [123, 456];

  const mockReview = {
    id: mockReviewId,
    scenarioSessionId: mockScenarioSessionId,
    createdBy: 123,
    tenantId: 'tenant-1',
    status: 'IN_REVIEW',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCountResult = [
    { userId: 123, count: 10 },
    { userId: 456, count: 5 },
  ];

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewSharedService,
        {
          provide: ReviewRepository,
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: ReviewReactionRepository,
          useValue: {
            getGivenReviewReactionsCountPerUser: jest.fn(),
            getReceivedReviewReactionsCountPerUser: jest.fn(),
          },
        },
        {
          provide: ReviewCommentRepository,
          useValue: {
            getGivenCommentsCountPerUser: jest.fn(),
            getGivenRepliesCountAsReviewOwner: jest.fn(),
            getReceivedCommentsCountPerUser: jest.fn(),
            getReceivedRepliesCountAsCommenter: jest.fn(),
          },
        },
        {
          provide: ReviewCommentReactionRepository,
          useValue: {
            getGivenCommentsReactionsCountPerUser: jest.fn(),
            getReceivedCommentsReactionsCountPerUser: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ReviewSharedService>(ReviewSharedService);
    reviewRepository = module.get(ReviewRepository);
    reviewReactionRepository = module.get(ReviewReactionRepository);
    reviewCommentRepository = module.get(ReviewCommentRepository);
    reviewCommentReactionRepository = module.get(
      ReviewCommentReactionRepository,
    );
  });

  describe('getReviewByScenarioSessionId', () => {
    it('should return review when found', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);

      const result = await service.getReviewByScenarioSessionId(
        mockScenarioSessionId,
      );

      expect(result).toEqual(mockReview);
      expect(reviewRepository.findOne).toHaveBeenCalledWith({
        where: { scenarioSessionId: mockScenarioSessionId },
      });
    });

    it('should return null when review not found', async () => {
      reviewRepository.findOne.mockResolvedValue(null);

      const result = await service.getReviewByScenarioSessionId(
        mockScenarioSessionId,
      );

      expect(result).toBeNull();
      expect(reviewRepository.findOne).toHaveBeenCalledWith({
        where: { scenarioSessionId: mockScenarioSessionId },
      });
    });
  });

  describe('getGivenCommentsReactionsCountPerUser', () => {
    it('should return count data when tenantIds are provided', async () => {
      reviewCommentReactionRepository.getGivenCommentsReactionsCountPerUser.mockResolvedValue(
        mockCountResult,
      );

      const result =
        await service.getGivenCommentsReactionsCountPerUser(mockTenantIds);

      expect(result).toEqual(mockCountResult);
      expect(
        reviewCommentReactionRepository.getGivenCommentsReactionsCountPerUser,
      ).toHaveBeenCalledWith(mockTenantIds, undefined);
    });

    it('should return count data when userIds are provided', async () => {
      reviewCommentReactionRepository.getGivenCommentsReactionsCountPerUser.mockResolvedValue(
        mockCountResult,
      );

      const result = await service.getGivenCommentsReactionsCountPerUser(
        undefined,
        mockUserIds,
      );

      expect(result).toEqual(mockCountResult);
      expect(
        reviewCommentReactionRepository.getGivenCommentsReactionsCountPerUser,
      ).toHaveBeenCalledWith(undefined, mockUserIds);
    });

    it('should return count data when both tenantIds and userIds are provided', async () => {
      reviewCommentReactionRepository.getGivenCommentsReactionsCountPerUser.mockResolvedValue(
        mockCountResult,
      );

      const result = await service.getGivenCommentsReactionsCountPerUser(
        mockTenantIds,
        mockUserIds,
      );

      expect(result).toEqual(mockCountResult);
      expect(
        reviewCommentReactionRepository.getGivenCommentsReactionsCountPerUser,
      ).toHaveBeenCalledWith(mockTenantIds, mockUserIds);
    });

    it('should return empty array when no parameters are provided', async () => {
      reviewCommentReactionRepository.getGivenCommentsReactionsCountPerUser.mockResolvedValue(
        [],
      );

      const result = await service.getGivenCommentsReactionsCountPerUser();

      expect(result).toEqual([]);
      expect(
        reviewCommentReactionRepository.getGivenCommentsReactionsCountPerUser,
      ).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  describe('getReceivedCommentsReactionsCountPerUser', () => {
    it('should return count data when tenantIds are provided', async () => {
      reviewCommentReactionRepository.getReceivedCommentsReactionsCountPerUser.mockResolvedValue(
        mockCountResult,
      );

      const result =
        await service.getReceivedCommentsReactionsCountPerUser(mockTenantIds);

      expect(result).toEqual(mockCountResult);
      expect(
        reviewCommentReactionRepository.getReceivedCommentsReactionsCountPerUser,
      ).toHaveBeenCalledWith(mockTenantIds, undefined);
    });

    it('should return count data when userIds are provided', async () => {
      reviewCommentReactionRepository.getReceivedCommentsReactionsCountPerUser.mockResolvedValue(
        mockCountResult,
      );

      const result = await service.getReceivedCommentsReactionsCountPerUser(
        undefined,
        mockUserIds,
      );

      expect(result).toEqual(mockCountResult);
      expect(
        reviewCommentReactionRepository.getReceivedCommentsReactionsCountPerUser,
      ).toHaveBeenCalledWith(undefined, mockUserIds);
    });

    it('should return count data when both tenantIds and userIds are provided', async () => {
      reviewCommentReactionRepository.getReceivedCommentsReactionsCountPerUser.mockResolvedValue(
        mockCountResult,
      );

      const result = await service.getReceivedCommentsReactionsCountPerUser(
        mockTenantIds,
        mockUserIds,
      );

      expect(result).toEqual(mockCountResult);
      expect(
        reviewCommentReactionRepository.getReceivedCommentsReactionsCountPerUser,
      ).toHaveBeenCalledWith(mockTenantIds, mockUserIds);
    });

    it('should return empty array when no parameters are provided', async () => {
      reviewCommentReactionRepository.getReceivedCommentsReactionsCountPerUser.mockResolvedValue(
        [],
      );

      const result = await service.getReceivedCommentsReactionsCountPerUser();

      expect(result).toEqual([]);
      expect(
        reviewCommentReactionRepository.getReceivedCommentsReactionsCountPerUser,
      ).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  describe('getGivenReviewReactionsCountPerUser', () => {
    it('should return count data when tenantIds are provided', async () => {
      reviewReactionRepository.getGivenReviewReactionsCountPerUser.mockResolvedValue(
        mockCountResult,
      );

      const result =
        await service.getGivenReviewReactionsCountPerUser(mockTenantIds);

      expect(result).toEqual(mockCountResult);
      expect(
        reviewReactionRepository.getGivenReviewReactionsCountPerUser,
      ).toHaveBeenCalledWith(mockTenantIds, undefined);
    });

    it('should return count data when userIds are provided', async () => {
      reviewReactionRepository.getGivenReviewReactionsCountPerUser.mockResolvedValue(
        mockCountResult,
      );

      const result = await service.getGivenReviewReactionsCountPerUser(
        undefined,
        mockUserIds,
      );

      expect(result).toEqual(mockCountResult);
      expect(
        reviewReactionRepository.getGivenReviewReactionsCountPerUser,
      ).toHaveBeenCalledWith(undefined, mockUserIds);
    });

    it('should return count data when both tenantIds and userIds are provided', async () => {
      reviewReactionRepository.getGivenReviewReactionsCountPerUser.mockResolvedValue(
        mockCountResult,
      );

      const result = await service.getGivenReviewReactionsCountPerUser(
        mockTenantIds,
        mockUserIds,
      );

      expect(result).toEqual(mockCountResult);
      expect(
        reviewReactionRepository.getGivenReviewReactionsCountPerUser,
      ).toHaveBeenCalledWith(mockTenantIds, mockUserIds);
    });

    it('should return empty array when no parameters are provided', async () => {
      reviewReactionRepository.getGivenReviewReactionsCountPerUser.mockResolvedValue(
        [],
      );

      const result = await service.getGivenReviewReactionsCountPerUser();

      expect(result).toEqual([]);
      expect(
        reviewReactionRepository.getGivenReviewReactionsCountPerUser,
      ).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  describe('getReceivedReviewReactionsCountPerUser', () => {
    it('should return count data when tenantIds are provided', async () => {
      reviewReactionRepository.getReceivedReviewReactionsCountPerUser.mockResolvedValue(
        mockCountResult,
      );

      const result =
        await service.getReceivedReviewReactionsCountPerUser(mockTenantIds);

      expect(result).toEqual(mockCountResult);
      expect(
        reviewReactionRepository.getReceivedReviewReactionsCountPerUser,
      ).toHaveBeenCalledWith(mockTenantIds, undefined);
    });

    it('should return count data when userIds are provided', async () => {
      reviewReactionRepository.getReceivedReviewReactionsCountPerUser.mockResolvedValue(
        mockCountResult,
      );

      const result = await service.getReceivedReviewReactionsCountPerUser(
        undefined,
        mockUserIds,
      );

      expect(result).toEqual(mockCountResult);
      expect(
        reviewReactionRepository.getReceivedReviewReactionsCountPerUser,
      ).toHaveBeenCalledWith(undefined, mockUserIds);
    });

    it('should return count data when both tenantIds and userIds are provided', async () => {
      reviewReactionRepository.getReceivedReviewReactionsCountPerUser.mockResolvedValue(
        mockCountResult,
      );

      const result = await service.getReceivedReviewReactionsCountPerUser(
        mockTenantIds,
        mockUserIds,
      );

      expect(result).toEqual(mockCountResult);
      expect(
        reviewReactionRepository.getReceivedReviewReactionsCountPerUser,
      ).toHaveBeenCalledWith(mockTenantIds, mockUserIds);
    });

    it('should return empty array when no parameters are provided', async () => {
      reviewReactionRepository.getReceivedReviewReactionsCountPerUser.mockResolvedValue(
        [],
      );

      const result = await service.getReceivedReviewReactionsCountPerUser();

      expect(result).toEqual([]);
      expect(
        reviewReactionRepository.getReceivedReviewReactionsCountPerUser,
      ).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  describe('getGivenCommentsCountPerUser', () => {
    it('should return count data when tenantIds are provided', async () => {
      reviewCommentRepository.getGivenCommentsCountPerUser.mockResolvedValue(
        mockCountResult,
      );

      const result = await service.getGivenCommentsCountPerUser(mockTenantIds);

      expect(result).toEqual(mockCountResult);
      expect(
        reviewCommentRepository.getGivenCommentsCountPerUser,
      ).toHaveBeenCalledWith(mockTenantIds, undefined);
    });

    it('should return count data when userIds are provided', async () => {
      reviewCommentRepository.getGivenCommentsCountPerUser.mockResolvedValue(
        mockCountResult,
      );

      const result = await service.getGivenCommentsCountPerUser(
        undefined,
        mockUserIds,
      );

      expect(result).toEqual(mockCountResult);
      expect(
        reviewCommentRepository.getGivenCommentsCountPerUser,
      ).toHaveBeenCalledWith(undefined, mockUserIds);
    });

    it('should return count data when both tenantIds and userIds are provided', async () => {
      reviewCommentRepository.getGivenCommentsCountPerUser.mockResolvedValue(
        mockCountResult,
      );

      const result = await service.getGivenCommentsCountPerUser(
        mockTenantIds,
        mockUserIds,
      );

      expect(result).toEqual(mockCountResult);
      expect(
        reviewCommentRepository.getGivenCommentsCountPerUser,
      ).toHaveBeenCalledWith(mockTenantIds, mockUserIds);
    });

    it('should return empty array when no parameters are provided', async () => {
      reviewCommentRepository.getGivenCommentsCountPerUser.mockResolvedValue(
        [],
      );

      const result = await service.getGivenCommentsCountPerUser();

      expect(result).toEqual([]);
      expect(
        reviewCommentRepository.getGivenCommentsCountPerUser,
      ).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  describe('getGivenRepliesCountAsReviewOwner', () => {
    it('should return count data when tenantIds are provided', async () => {
      reviewCommentRepository.getGivenRepliesCountAsReviewOwner.mockResolvedValue(
        mockCountResult,
      );

      const result =
        await service.getGivenRepliesCountAsReviewOwner(mockTenantIds);

      expect(result).toEqual(mockCountResult);
      expect(
        reviewCommentRepository.getGivenRepliesCountAsReviewOwner,
      ).toHaveBeenCalledWith(mockTenantIds, undefined);
    });

    it('should return count data when userIds are provided', async () => {
      reviewCommentRepository.getGivenRepliesCountAsReviewOwner.mockResolvedValue(
        mockCountResult,
      );

      const result = await service.getGivenRepliesCountAsReviewOwner(
        undefined,
        mockUserIds,
      );

      expect(result).toEqual(mockCountResult);
      expect(
        reviewCommentRepository.getGivenRepliesCountAsReviewOwner,
      ).toHaveBeenCalledWith(undefined, mockUserIds);
    });

    it('should return count data when both tenantIds and userIds are provided', async () => {
      reviewCommentRepository.getGivenRepliesCountAsReviewOwner.mockResolvedValue(
        mockCountResult,
      );

      const result = await service.getGivenRepliesCountAsReviewOwner(
        mockTenantIds,
        mockUserIds,
      );

      expect(result).toEqual(mockCountResult);
      expect(
        reviewCommentRepository.getGivenRepliesCountAsReviewOwner,
      ).toHaveBeenCalledWith(mockTenantIds, mockUserIds);
    });

    it('should return empty array when no parameters are provided', async () => {
      reviewCommentRepository.getGivenRepliesCountAsReviewOwner.mockResolvedValue(
        [],
      );

      const result = await service.getGivenRepliesCountAsReviewOwner();

      expect(result).toEqual([]);
      expect(
        reviewCommentRepository.getGivenRepliesCountAsReviewOwner,
      ).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  describe('getReceivedCommentsCountPerUser', () => {
    it('should return count data when tenantIds are provided', async () => {
      reviewCommentRepository.getReceivedCommentsCountPerUser.mockResolvedValue(
        mockCountResult,
      );

      const result =
        await service.getReceivedCommentsCountPerUser(mockTenantIds);

      expect(result).toEqual(mockCountResult);
      expect(
        reviewCommentRepository.getReceivedCommentsCountPerUser,
      ).toHaveBeenCalledWith(mockTenantIds, undefined);
    });

    it('should return count data when userIds are provided', async () => {
      reviewCommentRepository.getReceivedCommentsCountPerUser.mockResolvedValue(
        mockCountResult,
      );

      const result = await service.getReceivedCommentsCountPerUser(
        undefined,
        mockUserIds,
      );

      expect(result).toEqual(mockCountResult);
      expect(
        reviewCommentRepository.getReceivedCommentsCountPerUser,
      ).toHaveBeenCalledWith(undefined, mockUserIds);
    });

    it('should return count data when both tenantIds and userIds are provided', async () => {
      reviewCommentRepository.getReceivedCommentsCountPerUser.mockResolvedValue(
        mockCountResult,
      );

      const result = await service.getReceivedCommentsCountPerUser(
        mockTenantIds,
        mockUserIds,
      );

      expect(result).toEqual(mockCountResult);
      expect(
        reviewCommentRepository.getReceivedCommentsCountPerUser,
      ).toHaveBeenCalledWith(mockTenantIds, mockUserIds);
    });

    it('should return empty array when no parameters are provided', async () => {
      reviewCommentRepository.getReceivedCommentsCountPerUser.mockResolvedValue(
        [],
      );

      const result = await service.getReceivedCommentsCountPerUser();

      expect(result).toEqual([]);
      expect(
        reviewCommentRepository.getReceivedCommentsCountPerUser,
      ).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  describe('getReceivedRepliesCountAsCommenter', () => {
    it('should return count data when tenantIds are provided', async () => {
      reviewCommentRepository.getReceivedRepliesCountAsCommenter.mockResolvedValue(
        mockCountResult,
      );

      const result =
        await service.getReceivedRepliesCountAsCommenter(mockTenantIds);

      expect(result).toEqual(mockCountResult);
      expect(
        reviewCommentRepository.getReceivedRepliesCountAsCommenter,
      ).toHaveBeenCalledWith(mockTenantIds, undefined);
    });

    it('should return count data when userIds are provided', async () => {
      reviewCommentRepository.getReceivedRepliesCountAsCommenter.mockResolvedValue(
        mockCountResult,
      );

      const result = await service.getReceivedRepliesCountAsCommenter(
        undefined,
        mockUserIds,
      );

      expect(result).toEqual(mockCountResult);
      expect(
        reviewCommentRepository.getReceivedRepliesCountAsCommenter,
      ).toHaveBeenCalledWith(undefined, mockUserIds);
    });

    it('should return count data when both tenantIds and userIds are provided', async () => {
      reviewCommentRepository.getReceivedRepliesCountAsCommenter.mockResolvedValue(
        mockCountResult,
      );

      const result = await service.getReceivedRepliesCountAsCommenter(
        mockTenantIds,
        mockUserIds,
      );

      expect(result).toEqual(mockCountResult);
      expect(
        reviewCommentRepository.getReceivedRepliesCountAsCommenter,
      ).toHaveBeenCalledWith(mockTenantIds, mockUserIds);
    });

    it('should return empty array when no parameters are provided', async () => {
      reviewCommentRepository.getReceivedRepliesCountAsCommenter.mockResolvedValue(
        [],
      );

      const result = await service.getReceivedRepliesCountAsCommenter();

      expect(result).toEqual([]);
      expect(
        reviewCommentRepository.getReceivedRepliesCountAsCommenter,
      ).toHaveBeenCalledWith(undefined, undefined);
    });
  });
});
