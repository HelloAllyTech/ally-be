import { Test, TestingModule } from '@nestjs/testing';
import { BadgeEventConsumer } from '../badge.event.consumer';
import { BadgeAwardService } from '../../service/badge-award.service';
import { MinutesPlayedUpdatedEventParams } from 'src/learn/type/scenario-session-leaderboard-event.type';

describe('BadgeEventConsumer', () => {
  let consumer: BadgeEventConsumer;
  let badgeAwardService: jest.Mocked<BadgeAwardService>;

  const mockUserId = 42;
  const mockTenantId = 'tenant-1';

  const event = (
    overrides: Partial<MinutesPlayedUpdatedEventParams> = {},
  ): MinutesPlayedUpdatedEventParams => ({
    userId: mockUserId,
    tenantId: mockTenantId,
    businessDate: '2026-08-09',
    crossedActiveThreshold: false,
    ...overrides,
  });

  beforeEach(async () => {
    const mockBadgeAwardService = {
      awardSimulationMinutesBadgeByUserId: jest.fn(),
      awardActiveDayStreakBadgeByUserId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BadgeEventConsumer,
        { provide: BadgeAwardService, useValue: mockBadgeAwardService },
      ],
    }).compile();

    consumer = module.get<BadgeEventConsumer>(BadgeEventConsumer);
    badgeAwardService = module.get(BadgeAwardService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleMinutesPlayedUpdated', () => {
    it('should always evaluate simulation minutes badges', async () => {
      await consumer.handleMinutesPlayedUpdated(event());

      expect(
        badgeAwardService.awardSimulationMinutesBadgeByUserId,
      ).toHaveBeenCalledWith(mockUserId);
    });

    it('should evaluate streak badges when the day crosses the active threshold', async () => {
      await consumer.handleMinutesPlayedUpdated(
        event({ crossedActiveThreshold: true }),
      );

      expect(
        badgeAwardService.awardActiveDayStreakBadgeByUserId,
      ).toHaveBeenCalledWith(mockUserId, mockTenantId);
    });

    it('should skip streak badges when the day has not become active', async () => {
      await consumer.handleMinutesPlayedUpdated(
        event({ crossedActiveThreshold: false }),
      );

      expect(
        badgeAwardService.awardActiveDayStreakBadgeByUserId,
      ).not.toHaveBeenCalled();
    });

    it('should evaluate streak badges exactly once across a day built from sub-minute sessions', async () => {
      // Regression: the old guard skipped whenever a user_daily_scores row
      // already existed. A 0.5-minute first session created that row without
      // making the day active, so every later session that day returned early
      // and the streak badge was never awarded. The threshold crossing — which
      // happens on the second session here — is the correct trigger.
      const sessions = [
        { crossedActiveThreshold: false }, // 0.5 min, day total 0.5 — not active
        { crossedActiveThreshold: true }, // 0.5 min, day total 1.0 — now active
        { crossedActiveThreshold: false }, // 0.5 min, day total 1.5 — already active
        { crossedActiveThreshold: false }, // 0.5 min, day total 2.0 — already active
      ];

      for (const session of sessions) {
        await consumer.handleMinutesPlayedUpdated(event(session));
      }

      expect(
        badgeAwardService.awardActiveDayStreakBadgeByUserId,
      ).toHaveBeenCalledTimes(1);
      expect(
        badgeAwardService.awardActiveDayStreakBadgeByUserId,
      ).toHaveBeenCalledWith(mockUserId, mockTenantId);
    });

    it('should pass the tenant through so badges are not awarded on another tenant activity', async () => {
      await consumer.handleMinutesPlayedUpdated(
        event({ tenantId: 'tenant-2', crossedActiveThreshold: true }),
      );

      expect(
        badgeAwardService.awardActiveDayStreakBadgeByUserId,
      ).toHaveBeenCalledWith(mockUserId, 'tenant-2');
    });
  });
});
