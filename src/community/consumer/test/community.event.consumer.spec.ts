import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CommunityEventConsumer } from '../community.event.consumer';
import { UserDailyScoreRepository } from '../../repository/user-daily-score.repository';
import { scorePoints } from '../../constant/community.constant';
import { LeaderboardActionEvent } from 'src/learn/type/scenario-session-leaderboard-event.type';

describe('CommunityEventConsumer', () => {
  let consumer: CommunityEventConsumer;
  let userDailyScoreRepository: jest.Mocked<UserDailyScoreRepository>;
  let dataSource: jest.Mocked<DataSource>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  const mockTenantId = 'tenant-123';
  const mockUserId = 1;
  const mockReviewOwnerId = 2;
  const mockCommentOwnerId = 3;

  beforeEach(async () => {
    const mockUserDailyScoreRepository = {
      incrementTotalScore: jest.fn(),
      decrementTotalScore: jest.fn(),
      upsertDailyScore: jest.fn(),
      findOne: jest.fn(),
    };

    const mockDataSource = {
      transaction: jest.fn(),
    };

    const mockEventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunityEventConsumer,
        {
          provide: UserDailyScoreRepository,
          useValue: mockUserDailyScoreRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
      ],
    }).compile();

    consumer = module.get<CommunityEventConsumer>(CommunityEventConsumer);
    userDailyScoreRepository = module.get(UserDailyScoreRepository);
    dataSource = module.get(DataSource);
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleReviewReactionAdded', () => {
    it('should increment score when reactor is not the review owner', async () => {
      const params = {
        review: { createdBy: mockReviewOwnerId } as any,
        reaction: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
      };

      await consumer.handleReviewReactionAdded(params);

      expect(userDailyScoreRepository.incrementTotalScore).toHaveBeenCalledWith(
        mockUserId,
        mockTenantId,
        scorePoints.REACTION,
      );
    });

    it('should NOT increment score when reactor is the review owner (self-reaction)', async () => {
      const params = {
        review: { createdBy: mockUserId } as any,
        reaction: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
      };

      await consumer.handleReviewReactionAdded(params);

      expect(
        userDailyScoreRepository.incrementTotalScore,
      ).not.toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      userDailyScoreRepository.incrementTotalScore.mockRejectedValue(
        new Error('Database error'),
      );

      const params = {
        review: { createdBy: mockReviewOwnerId } as any,
        reaction: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
      };

      // Should not throw
      await expect(
        consumer.handleReviewReactionAdded(params),
      ).resolves.not.toThrow();
    });
  });

  describe('handleReviewReactionRemoved', () => {
    it('should decrement score when reactor is not the review owner', async () => {
      const params = {
        review: { createdBy: mockReviewOwnerId } as any,
        removedReaction: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
      };

      await consumer.handleReviewReactionRemoved(params);

      expect(userDailyScoreRepository.decrementTotalScore).toHaveBeenCalledWith(
        mockUserId,
        mockTenantId,
        scorePoints.REACTION,
      );
    });

    it('should NOT decrement score when reactor is the review owner (self-reaction)', async () => {
      const params = {
        review: { createdBy: mockUserId } as any,
        removedReaction: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
      };

      await consumer.handleReviewReactionRemoved(params);

      expect(
        userDailyScoreRepository.decrementTotalScore,
      ).not.toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      userDailyScoreRepository.decrementTotalScore.mockRejectedValue(
        new Error('Database error'),
      );

      const params = {
        review: { createdBy: mockReviewOwnerId } as any,
        removedReaction: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
      };

      await expect(
        consumer.handleReviewReactionRemoved(params),
      ).resolves.not.toThrow();
    });
  });

  describe('handleReviewCommentAdded', () => {
    it('should increment score when commenter is not the review owner', async () => {
      const params = {
        review: { createdBy: mockReviewOwnerId } as any,
        comment: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
      };

      await consumer.handleReviewCommentAdded(params);

      expect(userDailyScoreRepository.incrementTotalScore).toHaveBeenCalledWith(
        mockUserId,
        mockTenantId,
        scorePoints.COMMENT,
      );
    });

    it('should NOT increment score when commenter is the review owner (self-comment)', async () => {
      const params = {
        review: { createdBy: mockUserId } as any,
        comment: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
      };

      await consumer.handleReviewCommentAdded(params);

      expect(
        userDailyScoreRepository.incrementTotalScore,
      ).not.toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      userDailyScoreRepository.incrementTotalScore.mockRejectedValue(
        new Error('Database error'),
      );

      const params = {
        review: { createdBy: mockReviewOwnerId } as any,
        comment: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
      };

      await expect(
        consumer.handleReviewCommentAdded(params),
      ).resolves.not.toThrow();
    });
  });

  describe('handleReviewCommentRemoved', () => {
    it('should decrement score for commenter when commenter is not the review owner', async () => {
      const mockEntityManager = {} as EntityManager;
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (callback: any) => {
          return callback(mockEntityManager);
        },
      );

      const params = {
        review: { createdBy: mockReviewOwnerId } as any,
        comment: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
      };

      await consumer.handleReviewCommentRemoved(params);

      expect(userDailyScoreRepository.decrementTotalScore).toHaveBeenCalledWith(
        mockUserId,
        mockTenantId,
        scorePoints.COMMENT,
        mockEntityManager,
      );
    });

    it('should NOT decrement score when commenter is the review owner (self-comment)', async () => {
      const params = {
        review: { createdBy: mockUserId } as any,
        comment: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
      };

      await consumer.handleReviewCommentRemoved(params);

      expect(
        userDailyScoreRepository.decrementTotalScore,
      ).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('should decrement scores for all comment replies', async () => {
      const mockEntityManager = {} as EntityManager;
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (callback: any) => {
          return callback(mockEntityManager);
        },
      );

      const commentReplies = [
        { createdBy: 10, tenantId: mockTenantId },
        { createdBy: 11, tenantId: mockTenantId },
      ];

      const params = {
        review: { createdBy: mockReviewOwnerId } as any,
        comment: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
        commentReplies: commentReplies as any[],
      };

      await consumer.handleReviewCommentRemoved(params);

      // Original comment + 2 replies = 3 calls
      expect(
        userDailyScoreRepository.decrementTotalScore,
      ).toHaveBeenCalledTimes(3);
      expect(userDailyScoreRepository.decrementTotalScore).toHaveBeenCalledWith(
        10,
        mockTenantId,
        scorePoints.COMMENT,
        mockEntityManager,
      );
      expect(userDailyScoreRepository.decrementTotalScore).toHaveBeenCalledWith(
        11,
        mockTenantId,
        scorePoints.COMMENT,
        mockEntityManager,
      );
    });

    it('should decrement scores for all comment reactions', async () => {
      const mockEntityManager = {} as EntityManager;
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (callback: any) => {
          return callback(mockEntityManager);
        },
      );

      const commentReactions = [
        { createdBy: 10, tenantId: mockTenantId },
        { createdBy: 11, tenantId: mockTenantId },
      ];

      const params = {
        review: { createdBy: mockReviewOwnerId } as any,
        comment: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
        commentReactions: commentReactions as any[],
      };

      await consumer.handleReviewCommentRemoved(params);

      // Original comment + 2 reactions = 3 calls
      expect(
        userDailyScoreRepository.decrementTotalScore,
      ).toHaveBeenCalledTimes(3);
      expect(userDailyScoreRepository.decrementTotalScore).toHaveBeenCalledWith(
        10,
        mockTenantId,
        scorePoints.REACTION,
        mockEntityManager,
      );
      expect(userDailyScoreRepository.decrementTotalScore).toHaveBeenCalledWith(
        11,
        mockTenantId,
        scorePoints.REACTION,
        mockEntityManager,
      );
    });

    it('should decrement scores for all comment reply reactions', async () => {
      const mockEntityManager = {} as EntityManager;
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (callback: any) => {
          return callback(mockEntityManager);
        },
      );

      const commentReplyReactions = [{ createdBy: 10, tenantId: mockTenantId }];

      const params = {
        review: { createdBy: mockReviewOwnerId } as any,
        comment: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
        commentReplyReactions: commentReplyReactions as any[],
      };

      await consumer.handleReviewCommentRemoved(params);

      // Original comment + 1 reply reaction = 2 calls
      expect(
        userDailyScoreRepository.decrementTotalScore,
      ).toHaveBeenCalledTimes(2);
      expect(userDailyScoreRepository.decrementTotalScore).toHaveBeenCalledWith(
        10,
        mockTenantId,
        scorePoints.REACTION,
        mockEntityManager,
      );
    });

    it('should handle all cascading deletions in a single transaction', async () => {
      const mockEntityManager = {} as EntityManager;
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (callback: any) => {
          return callback(mockEntityManager);
        },
      );

      const params = {
        review: { createdBy: mockReviewOwnerId } as any,
        comment: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
        commentReplies: [{ createdBy: 10, tenantId: mockTenantId }] as any[],
        commentReactions: [{ createdBy: 11, tenantId: mockTenantId }] as any[],
        commentReplyReactions: [
          { createdBy: 12, tenantId: mockTenantId },
        ] as any[],
      };

      await consumer.handleReviewCommentRemoved(params);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      // comment + 1 reply + 1 reaction + 1 reply reaction = 4 calls
      expect(
        userDailyScoreRepository.decrementTotalScore,
      ).toHaveBeenCalledTimes(4);
    });

    it('should handle empty arrays gracefully', async () => {
      const mockEntityManager = {} as EntityManager;
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (callback: any) => {
          return callback(mockEntityManager);
        },
      );

      const params = {
        review: { createdBy: mockReviewOwnerId } as any,
        comment: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
        commentReplies: [],
        commentReactions: [],
        commentReplyReactions: [],
      };

      await consumer.handleReviewCommentRemoved(params);

      // Only the original comment
      expect(
        userDailyScoreRepository.decrementTotalScore,
      ).toHaveBeenCalledTimes(1);
    });

    it('should handle database errors gracefully', async () => {
      dataSource.transaction.mockRejectedValue(new Error('Transaction failed'));

      const params = {
        review: { createdBy: mockReviewOwnerId } as any,
        comment: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
      };

      await expect(
        consumer.handleReviewCommentRemoved(params),
      ).resolves.not.toThrow();
    });
  });

  describe('handleReviewCommentReactionAdded', () => {
    it('should increment score when reactor is not the comment owner', async () => {
      const params = {
        comment: { createdBy: mockCommentOwnerId } as any,
        reaction: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
        review: { createdBy: mockReviewOwnerId } as any,
      };

      await consumer.handleReviewCommentReactionAdded(params);

      expect(userDailyScoreRepository.incrementTotalScore).toHaveBeenCalledWith(
        mockUserId,
        mockTenantId,
        scorePoints.REACTION,
      );
    });

    it('should NOT increment score when reactor is the comment owner (self-reaction)', async () => {
      const params = {
        comment: { createdBy: mockUserId } as any,
        reaction: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
        review: { createdBy: mockReviewOwnerId } as any,
      };

      await consumer.handleReviewCommentReactionAdded(params);

      expect(
        userDailyScoreRepository.incrementTotalScore,
      ).not.toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      userDailyScoreRepository.incrementTotalScore.mockRejectedValue(
        new Error('Database error'),
      );

      const params = {
        comment: { createdBy: mockCommentOwnerId } as any,
        reaction: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
        review: { createdBy: mockReviewOwnerId } as any,
      };

      await expect(
        consumer.handleReviewCommentReactionAdded(params),
      ).resolves.not.toThrow();
    });
  });

  describe('handleReviewCommentReactionRemoved', () => {
    it('should decrement score when reactor is not the comment owner', async () => {
      const params = {
        comment: { createdBy: mockCommentOwnerId } as any,
        removedReaction: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
        review: { createdBy: mockReviewOwnerId } as any,
      };

      await consumer.handleReviewCommentReactionRemoved(params);

      expect(userDailyScoreRepository.decrementTotalScore).toHaveBeenCalledWith(
        mockUserId,
        mockTenantId,
        scorePoints.REACTION,
      );
    });

    it('should NOT decrement score when reactor is the comment owner (self-reaction)', async () => {
      const params = {
        comment: { createdBy: mockUserId } as any,
        removedReaction: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
        review: { createdBy: mockReviewOwnerId } as any,
      };

      await consumer.handleReviewCommentReactionRemoved(params);

      expect(
        userDailyScoreRepository.decrementTotalScore,
      ).not.toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      userDailyScoreRepository.decrementTotalScore.mockRejectedValue(
        new Error('Database error'),
      );

      const params = {
        comment: { createdBy: mockCommentOwnerId } as any,
        removedReaction: {
          createdBy: mockUserId,
          tenantId: mockTenantId,
        } as any,
        review: { createdBy: mockReviewOwnerId } as any,
      };

      await expect(
        consumer.handleReviewCommentReactionRemoved(params),
      ).resolves.not.toThrow();
    });
  });

  describe('handleScenarioSessionEnded', () => {
    it('should upsert daily score and emit event carrying the threshold crossing', async () => {
      const mockDate = new Date('2025-01-15');
      const mockDurationMinutes = 30;

      userDailyScoreRepository.upsertDailyScore.mockResolvedValue({
        businessDate: '2025-01-15',
        minutesAfter: 30,
        crossedActiveThreshold: true,
      });

      await consumer.handleScenarioSessionEnded({
        userId: mockUserId,
        tenantId: mockTenantId,
        date: mockDate,
        durationMinutes: mockDurationMinutes,
        scenarioSessionId: 'scenario-session-1',
      });

      expect(userDailyScoreRepository.upsertDailyScore).toHaveBeenCalledWith(
        mockUserId,
        mockTenantId,
        mockDate,
        mockDurationMinutes,
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        LeaderboardActionEvent.MINUTES_PLAYED_UPDATED,
        {
          userId: mockUserId,
          tenantId: mockTenantId,
          businessDate: '2025-01-15',
          crossedActiveThreshold: true,
        },
      );
    });

    it('should no longer pre-read the daily score row', async () => {
      userDailyScoreRepository.upsertDailyScore.mockResolvedValue({
        businessDate: '2025-01-15',
        minutesAfter: 0.5,
        crossedActiveThreshold: false,
      });

      await consumer.handleScenarioSessionEnded({
        userId: mockUserId,
        tenantId: mockTenantId,
        date: new Date('2025-01-15'),
        durationMinutes: 0.5,
        scenarioSessionId: 'scenario-session-1',
      });

      // The pre-read computed the day in Node-local time while the upsert used
      // the business timezone — two different answers for "which day is this".
      expect(userDailyScoreRepository.findOne).not.toHaveBeenCalled();
    });

    it('should emit crossedActiveThreshold=false for a sub-minute session', async () => {
      userDailyScoreRepository.upsertDailyScore.mockResolvedValue({
        businessDate: '2025-01-15',
        minutesAfter: 0.5,
        crossedActiveThreshold: false,
      });

      await consumer.handleScenarioSessionEnded({
        userId: mockUserId,
        tenantId: mockTenantId,
        date: new Date(),
        durationMinutes: 0.5,
        scenarioSessionId: 'scenario-session-1',
      });

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        LeaderboardActionEvent.MINUTES_PLAYED_UPDATED,
        expect.objectContaining({ crossedActiveThreshold: false }),
      );
    });

    it('should handle upsert errors gracefully', async () => {
      userDailyScoreRepository.upsertDailyScore.mockRejectedValue(
        new Error('Upsert failed'),
      );

      await expect(
        consumer.handleScenarioSessionEnded({
          userId: mockUserId,
          tenantId: mockTenantId,
          date: new Date(),
          durationMinutes: 15,
          scenarioSessionId: 'scenario-session-1',
        }),
      ).resolves.not.toThrow();

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });
});
