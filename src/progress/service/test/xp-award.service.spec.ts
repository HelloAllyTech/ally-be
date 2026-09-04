import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { CommunitySharedService } from 'src/community/service/community-shared.service';
import { UserProgressRepository } from '../../repository/user-progress.repository';
import { XpEventRepository } from '../../repository/xp-event.repository';
import { ProgressTenantResolver } from '../progress-tenant.resolver';
import { XpAwardService } from '../xp-award.service';
import {
  DAILY_PRACTICE_XP_CAP,
  MIN_SESSION_SECONDS_FOR_XP,
  PROGRESS_EVENTS,
  XP_AWARD,
  XP_RULE,
} from '../../progress.constants';

const TENANT_CODE = 'ally';
const TENANT_UUID = 'f948763c-8eeb-4def-ad74-8f3ed0e4cd39';
const USER_ID = 3;
const SESSION_ID = 'session-abc';

describe('XpAwardService', () => {
  let service: XpAwardService;
  let xpEventRepository: jest.Mocked<XpEventRepository>;
  let userProgressRepository: jest.Mocked<UserProgressRepository>;
  let communitySharedService: jest.Mocked<CommunitySharedService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  /** Whatever the transaction callback returns, run it against a stub manager. */
  const manager = {} as never;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        XpAwardService,
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn((cb: (m: unknown) => Promise<void>) =>
              cb(manager),
            ),
          },
        },
        {
          provide: XpEventRepository,
          useValue: {
            insertAwards: jest.fn().mockResolvedValue(0),
            lockUserDay: jest.fn().mockResolvedValue(undefined),
            getPracticeXpAwardedOn: jest.fn().mockResolvedValue(0),
            countPersonalBestsAwardedOn: jest.fn().mockResolvedValue(0),
          },
        },
        {
          provide: UserProgressRepository,
          useValue: {
            addXp: jest
              .fn()
              .mockResolvedValue({ totalXp: 0, previousLevel: 1 }),
            setLevel: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: CommunitySharedService,
          useValue: {
            getStreakStatsForUser: jest.fn().mockResolvedValue({
              userId: USER_ID,
              currentStreak: 0,
              longestStreak: 0,
              streakStartDate: null,
              lastActiveDate: null,
              previousRunLength: null,
              previousRunEndedOn: null,
            }),
          },
        },
        {
          provide: ProgressTenantResolver,
          useValue: { toCanonicalId: jest.fn().mockResolvedValue(TENANT_UUID) },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(XpAwardService);
    xpEventRepository = module.get(XpEventRepository);
    userProgressRepository = module.get(UserProgressRepository);
    communitySharedService = module.get(CommunitySharedService);
    eventEmitter = module.get(EventEmitter2);
  });

  const awardSession = (durationMs: number) =>
    service.awardForSession({
      userId: USER_ID,
      tenantId: TENANT_CODE,
      scenarioSessionId: SESSION_ID,
      durationMs,
      endedAt: new Date('2026-09-02T10:00:00Z'),
    });

  const awardsPassed = (): { rule: string; xp: number }[] =>
    xpEventRepository.insertAwards.mock.calls[0][4];

  describe('awardForSession', () => {
    it('resolves the tenant to its uuid so one learner cannot end up with two rows', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(20);
      await awardSession(10 * 60 * 1000);

      expect(xpEventRepository.insertAwards).toHaveBeenCalledWith(
        manager,
        USER_ID,
        TENANT_UUID,
        expect.any(String),
        expect.any(Array),
      );
    });

    it('awards nothing for a session below the minimum duration', async () => {
      await awardSession((MIN_SESSION_SECONDS_FOR_XP - 1) * 1000);

      expect(xpEventRepository.insertAwards).not.toHaveBeenCalled();
      expect(userProgressRepository.addXp).not.toHaveBeenCalled();
    });

    it('awards a minute per minute plus the completion bonus', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(20);
      await awardSession(10 * 60 * 1000);

      const awards = awardsPassed();
      expect(awards.find((a) => a.rule === XP_RULE.PRACTICE_MINUTE)?.xp).toBe(
        10,
      );
      expect(awards.find((a) => a.rule === XP_RULE.SESSION_COMPLETED)?.xp).toBe(
        XP_AWARD.PER_SESSION_COMPLETED,
      );
    });

    it('withholds the streak bonus before the streak threshold', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(20);
      await awardSession(10 * 60 * 1000);

      expect(
        awardsPassed().find((a) => a.rule === XP_RULE.STREAK_MULTIPLIER)?.xp,
      ).toBe(0);
    });

    it('counts today toward the streak even before the daily score row is written', async () => {
      // A two-day streak with nothing recorded for today yet: the learner has just
      // practised, so this session is day three and earns the bonus.
      communitySharedService.getStreakStatsForUser.mockResolvedValue({
        userId: USER_ID,
        currentStreak: 2,
        longestStreak: 5,
        streakStartDate: '2026-08-31',
        lastActiveDate: '2026-09-01',
        previousRunLength: null,
        previousRunEndedOn: null,
      });
      xpEventRepository.insertAwards.mockResolvedValue(23);

      await awardSession(10 * 60 * 1000);

      expect(
        awardsPassed().find((a) => a.rule === XP_RULE.STREAK_MULTIPLIER)?.xp,
      ).toBe(3);
    });

    it('clamps practice XP to what is left of the daily cap', async () => {
      xpEventRepository.getPracticeXpAwardedOn.mockResolvedValue(
        DAILY_PRACTICE_XP_CAP - 5,
      );
      xpEventRepository.insertAwards.mockResolvedValue(15);

      await awardSession(60 * 60 * 1000); // 60 minutes, far over the remaining 5

      const awards = awardsPassed();
      const practice =
        (awards.find((a) => a.rule === XP_RULE.PRACTICE_MINUTE)?.xp ?? 0) +
        (awards.find((a) => a.rule === XP_RULE.STREAK_MULTIPLIER)?.xp ?? 0);
      expect(practice).toBe(5);
      // The completion bonus sits outside the cap and is still paid.
      expect(awards.find((a) => a.rule === XP_RULE.SESSION_COMPLETED)?.xp).toBe(
        XP_AWARD.PER_SESSION_COMPLETED,
      );
    });

    /**
     * THE REGRESSION CASE. Without the lock, two SCENARIO_SESSION_ENDED events for the
     * same learner arriving close together — plausible via the unfinalised-session
     * sweeper — can both read the same stale "already awarded today" total and both pass
     * the daily cap. Do not delete this test.
     */
    it("takes the advisory lock BEFORE reading today's practice total", async () => {
      xpEventRepository.insertAwards.mockResolvedValue(20);
      const order: string[] = [];
      xpEventRepository.lockUserDay.mockImplementation(async () => {
        order.push('lock');
      });
      xpEventRepository.getPracticeXpAwardedOn.mockImplementation(async () => {
        order.push('read');
        return 0;
      });

      await awardSession(10 * 60 * 1000);

      // Reversed, and two concurrent awards both read a stale total and both pass the cap.
      expect(order).toEqual(['lock', 'read']);
    });

    it('adds nothing to the rollup when the ledger rejected every row as a duplicate', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(0);

      await awardSession(10 * 60 * 1000);

      expect(userProgressRepository.addXp).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('announces a level up only when the level actually advanced', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(120);
      userProgressRepository.addXp.mockResolvedValue({
        totalXp: 120,
        previousLevel: 1,
      });

      await awardSession(10 * 60 * 1000);

      expect(userProgressRepository.setLevel).toHaveBeenCalledWith(
        manager,
        USER_ID,
        TENANT_UUID,
        2,
        true,
        expect.any(Date),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        PROGRESS_EVENTS.LEVEL_UP,
        expect.objectContaining({ previousLevel: 1, level: 2 }),
      );
    });

    it('does not announce a level up when the learner stays put', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(10);
      userProgressRepository.addXp.mockResolvedValue({
        totalXp: 50,
        previousLevel: 1,
      });

      await awardSession(10 * 60 * 1000);

      expect(userProgressRepository.setLevel).not.toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        PROGRESS_EVENTS.XP_AWARDED,
        expect.any(Object),
      );
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        PROGRESS_EVENTS.LEVEL_UP,
        expect.any(Object),
      );
    });

    it('never lets a failure escape into the flow that triggered it', async () => {
      xpEventRepository.insertAwards.mockRejectedValue(new Error('db down'));

      await expect(awardSession(10 * 60 * 1000)).resolves.toBeUndefined();
    });
  });

  describe('awardSkillPersonalBest', () => {
    it('awards the bonus when none has been earned today', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(
        XP_AWARD.PER_SKILL_PERSONAL_BEST,
      );

      await service.awardSkillPersonalBest({
        userId: USER_ID,
        tenantId: TENANT_CODE,
        scenarioSessionId: SESSION_ID,
      });

      expect(awardsPassed()[0]).toEqual(
        expect.objectContaining({
          rule: XP_RULE.SKILL_PERSONAL_BEST,
          xp: XP_AWARD.PER_SKILL_PERSONAL_BEST,
        }),
      );
    });

    it('refuses a second personal best on the same day', async () => {
      xpEventRepository.countPersonalBestsAwardedOn.mockResolvedValue(1);

      await service.awardSkillPersonalBest({
        userId: USER_ID,
        tenantId: TENANT_CODE,
        scenarioSessionId: SESSION_ID,
      });

      expect(xpEventRepository.insertAwards).not.toHaveBeenCalled();
    });

    /**
     * THE REGRESSION CASE. Same race as the practice cap: without the lock, two
     * concurrent personal-best awards for the same learner can both read "0 today" and
     * both insert, pushing the learner past the one-per-day cap. Do not delete this test.
     */
    it("takes the advisory lock BEFORE reading today's personal-best count", async () => {
      xpEventRepository.insertAwards.mockResolvedValue(
        XP_AWARD.PER_SKILL_PERSONAL_BEST,
      );
      const order: string[] = [];
      xpEventRepository.lockUserDay.mockImplementation(async () => {
        order.push('lock');
      });
      xpEventRepository.countPersonalBestsAwardedOn.mockImplementation(
        async () => {
          order.push('read');
          return 0;
        },
      );

      await service.awardSkillPersonalBest({
        userId: USER_ID,
        tenantId: TENANT_CODE,
        scenarioSessionId: SESSION_ID,
      });

      // Reversed, and two concurrent awards both read a stale count and both pass the cap.
      expect(order).toEqual(['lock', 'read']);
    });
  });

  describe('awardForTrackItem', () => {
    it('awards the flat track item bonus', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(
        XP_AWARD.PER_TRACK_ITEM_COMPLETED,
      );

      await service.awardForTrackItem({
        userId: USER_ID,
        tenantId: TENANT_CODE,
        trackItemId: 'item-1',
      });

      expect(awardsPassed()[0]).toEqual(
        expect.objectContaining({
          rule: XP_RULE.TRACK_ITEM_COMPLETED,
          sourceId: 'item-1',
          xp: XP_AWARD.PER_TRACK_ITEM_COMPLETED,
        }),
      );
    });
  });
});
