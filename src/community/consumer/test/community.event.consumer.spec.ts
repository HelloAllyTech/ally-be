import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CommunityEventConsumer } from '../community.event.consumer';
import { UserDailyScoreRepository } from '../../repository/user-daily-score.repository';
import { LeaderboardActionEvent } from 'src/learn/type/scenario-session-leaderboard-event.type';

describe('CommunityEventConsumer', () => {
  let consumer: CommunityEventConsumer;
  let userDailyScoreRepository: jest.Mocked<UserDailyScoreRepository>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  const mockTenantId = 'tenant-123';
  const mockUserId = 1;

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
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
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
