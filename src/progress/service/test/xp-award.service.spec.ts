import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { TrackItemType } from 'src/track/type/track.type';
import { UserProgressRepository } from '../../repository/user-progress.repository';
import { SessionEngagementRepository } from '../../repository/session-engagement.repository';
import {
  XpAwardRow,
  XpEventRepository,
} from '../../repository/xp-event.repository';
import { ProgressTenantResolver } from '../progress-tenant.resolver';
import { XpAwardService } from '../xp-award.service';
import {
  DAILY_XP_CEILING,
  MIN_LEARNER_TURNS_FOR_XP,
  MIN_SESSION_SECONDS_FOR_XP,
  PER_SESSION_MINUTE_CEILING,
  PROGRESS_EVENTS,
  TRACK_ITEM_XP,
  WEEKLY_CONSISTENCY_DAYS,
  XP_AWARD,
  XP_RULE,
  XP_SOURCE_TYPE,
} from '../../progress.constants';

const TENANT_CODE = 'ally';
const TENANT_UUID = 'f948763c-8eeb-4def-ad74-8f3ed0e4cd39';
const USER_ID = 3;
const SESSION_ID = 'session-abc';
const ENDED_AT = new Date('2026-09-02T10:00:00Z');

/** Enough turns for any duration used below to clear the engagement gate. */
const PLENTY_OF_TURNS = 200;

describe('XpAwardService', () => {
  let service: XpAwardService;
  let xpEventRepository: jest.Mocked<XpEventRepository>;
  let userProgressRepository: jest.Mocked<UserProgressRepository>;
  let sessionEngagement: jest.Mocked<SessionEngagementRepository>;
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
            getXpAwardedOn: jest.fn().mockResolvedValue(0),
            getCappedXpAwardedOn: jest.fn().mockResolvedValue(0),
            getPracticeMinutesAwardedOn: jest.fn().mockResolvedValue(0),
            countQualifyingDaysBetween: jest.fn().mockResolvedValue(0),
            countRuleAwardedOn: jest.fn().mockResolvedValue(0),
            hasAward: jest.fn().mockResolvedValue(false),
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
          provide: SessionEngagementRepository,
          useValue: {
            countLearnerTurns: jest.fn().mockResolvedValue(PLENTY_OF_TURNS),
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
    sessionEngagement = module.get(SessionEngagementRepository);
    eventEmitter = module.get(EventEmitter2);
  });

  const awardSession = (durationMs: number) =>
    service.awardForSession({
      userId: USER_ID,
      tenantId: TENANT_CODE,
      scenarioSessionId: SESSION_ID,
      durationMs,
      endedAt: ENDED_AT,
    });

  /** Awards from the nth insertAwards call (0-based). */
  const awardsPassed = (call = 0): XpAwardRow[] =>
    xpEventRepository.insertAwards.mock.calls[call][4];

  const xpFor = (rule: string, call = 0): number =>
    awardsPassed(call)
      .filter((award) => award.rule === rule)
      .reduce((sum, award) => sum + award.xp, 0);

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
    });

    it('awards a minute per minute plus the completion bonus', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(20);
      await awardSession(10 * 60 * 1000);

      expect(xpFor(XP_RULE.PRACTICE_MINUTE)).toBe(10);
      expect(xpFor(XP_RULE.SESSION_COMPLETED)).toBe(
        XP_AWARD.PER_SESSION_COMPLETED,
      );
    });

    it('rounds minutes down', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(1);
      await awardSession(119 * 1000);

      expect(xpFor(XP_RULE.PRACTICE_MINUTE)).toBe(1);
    });

    describe('the engagement gate', () => {
      it('awards nothing when the learner never took a turn', async () => {
        sessionEngagement.countLearnerTurns.mockResolvedValue(0);
        await awardSession(30 * 60 * 1000);

        expect(xpEventRepository.insertAwards).not.toHaveBeenCalled();
      });

      it('awards nothing below the turn floor, however long the session ran', async () => {
        sessionEngagement.countLearnerTurns.mockResolvedValue(
          MIN_LEARNER_TURNS_FOR_XP - 1,
        );
        await awardSession(60 * 60 * 1000);

        expect(xpEventRepository.insertAwards).not.toHaveBeenCalled();
      });

      it('awards nothing when a few turns are spread over an idle hour', async () => {
        // 5 turns over 60 minutes is well under the per-minute floor.
        sessionEngagement.countLearnerTurns.mockResolvedValue(5);
        await awardSession(60 * 60 * 1000);

        expect(xpEventRepository.insertAwards).not.toHaveBeenCalled();
      });

      it('awards a short but busy session', async () => {
        xpEventRepository.insertAwards.mockResolvedValue(12);
        sessionEngagement.countLearnerTurns.mockResolvedValue(8);
        await awardSession(2 * 60 * 1000);

        expect(xpFor(XP_RULE.PRACTICE_MINUTE)).toBe(2);
      });
    });

    it('caps the minutes any single session can bank', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(1);
      await awardSession(3 * 60 * 60 * 1000);

      expect(xpFor(XP_RULE.PRACTICE_MINUTE)).toBe(PER_SESSION_MINUTE_CEILING);
    });

    it('pays each depth milestone the day crosses, once', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(1);
      await awardSession(40 * 60 * 1000);

      const milestones = awardsPassed().filter(
        (award) => award.rule === XP_RULE.DAILY_DEPTH_MILESTONE,
      );
      expect(milestones.map((m) => m.xp)).toEqual([10, 20]);
    });

    it('does not re-pay a milestone the day already crossed', async () => {
      xpEventRepository.getPracticeMinutesAwardedOn.mockResolvedValue(20);
      xpEventRepository.insertAwards.mockResolvedValue(1);
      await awardSession(15 * 60 * 1000);

      const milestones = awardsPassed().filter(
        (award) => award.rule === XP_RULE.DAILY_DEPTH_MILESTONE,
      );
      // 20 -> 35 crosses only the 30-minute mark; 15 was already behind us.
      expect(milestones.map((m) => m.xp)).toEqual([20]);
    });

    it('keys milestones on the day so a redelivered session cannot pay twice', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(1);
      await awardSession(20 * 60 * 1000);

      const milestone = awardsPassed().find(
        (award) => award.rule === XP_RULE.DAILY_DEPTH_MILESTONE,
      );
      expect(milestone?.sourceType).toBe(XP_SOURCE_TYPE.DAY);
      expect(milestone?.sourceId).toMatch(/^\d{4}-\d{2}-\d{2}:15$/);
    });

    describe('caps', () => {
      it('grants only the practice allowance left today', async () => {
        // 140 of the 150 practice cap is already spent.
        xpEventRepository.getXpAwardedOn.mockImplementation(
          async (_m, _u, _t, _d, rules: readonly string[]) =>
            rules.includes(XP_RULE.PRACTICE_MINUTE) ? 140 : 0,
        );
        xpEventRepository.insertAwards.mockResolvedValue(1);
        await awardSession(30 * 60 * 1000);

        expect(xpFor(XP_RULE.PRACTICE_MINUTE)).toBe(10);
      });

      it('never lets one batch push the day past the overall ceiling', async () => {
        xpEventRepository.getCappedXpAwardedOn.mockResolvedValue(
          DAILY_XP_CEILING - 12,
        );
        xpEventRepository.insertAwards.mockResolvedValue(1);
        await awardSession(45 * 60 * 1000);

        const total = awardsPassed().reduce((sum, a) => sum + a.xp, 0);
        expect(total).toBe(12);
      });

      it('grants nothing once the ceiling is reached', async () => {
        xpEventRepository.getCappedXpAwardedOn.mockResolvedValue(
          DAILY_XP_CEILING,
        );
        await awardSession(30 * 60 * 1000);

        const total = awardsPassed().reduce((sum, a) => sum + a.xp, 0);
        expect(total).toBe(0);
      });

      it('stops depth milestones accruing once practice XP is capped out', async () => {
        xpEventRepository.getXpAwardedOn.mockImplementation(
          async (_m, _u, _t, _d, rules: readonly string[]) =>
            rules.includes(XP_RULE.PRACTICE_MINUTE) ? 150 : 0,
        );
        xpEventRepository.insertAwards.mockResolvedValue(1);
        await awardSession(60 * 60 * 1000);

        expect(
          awardsPassed().filter(
            (award) => award.rule === XP_RULE.DAILY_DEPTH_MILESTONE,
          ),
        ).toHaveLength(0);
      });
    });

    it('emits a level-up only when the level actually moves', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(200);
      userProgressRepository.addXp.mockResolvedValue({
        totalXp: 300,
        previousLevel: 2,
      });
      await awardSession(10 * 60 * 1000);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        PROGRESS_EVENTS.LEVEL_UP,
        expect.objectContaining({ previousLevel: 2, level: 3 }),
      );
    });

    it('never throws when the ledger write fails', async () => {
      xpEventRepository.insertAwards.mockRejectedValue(new Error('pg down'));

      await expect(awardSession(10 * 60 * 1000)).resolves.toBeUndefined();
    });
  });

  describe('awardForTrackItem', () => {
    const awardItem = (itemType: string) =>
      service.awardForTrackItem({
        userId: USER_ID,
        tenantId: TENANT_CODE,
        trackItemId: 'item-1',
        itemType,
      });

    it('weights a graded quiz above a passive article', async () => {
      expect(TRACK_ITEM_XP[TrackItemType.QUIZ]).toBeGreaterThan(
        TRACK_ITEM_XP[TrackItemType.ARTICLE],
      );
    });

    it('awards the type weight', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(30);
      await awardItem(TrackItemType.QUIZ);

      expect(xpFor(XP_RULE.TRACK_ITEM_COMPLETED)).toBe(
        TRACK_ITEM_XP[TrackItemType.QUIZ],
      );
    });

    it('writes nothing for a roleplay item, whose session already paid', async () => {
      await awardItem(TrackItemType.ROLEPLAY);

      expect(xpEventRepository.insertAwards).not.toHaveBeenCalled();
    });

    it('writes nothing for an unrecognised type rather than guessing a weight', async () => {
      await awardItem('SOMETHING_NEW');

      expect(xpEventRepository.insertAwards).not.toHaveBeenCalled();
    });
  });

  describe('awardForDebriefThread', () => {
    it('keys on the session so a longer conversation is not paid twice', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(
        XP_AWARD.PER_DEBRIEF_THREAD,
      );
      await service.awardForDebriefThread({
        userId: USER_ID,
        tenantId: TENANT_CODE,
        scenarioSessionId: SESSION_ID,
        at: ENDED_AT,
      });

      expect(awardsPassed()[0]).toMatchObject({
        rule: XP_RULE.DEBRIEF_THREAD,
        sourceType: XP_SOURCE_TYPE.DEBRIEF,
        sourceId: SESSION_ID,
        xp: XP_AWARD.PER_DEBRIEF_THREAD,
      });
    });
  });

  describe('awardForPeerComment', () => {
    it('pays per comment, keyed on the comment', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(
        XP_AWARD.PER_PEER_COMMENT,
      );
      await service.awardForPeerComment({
        userId: USER_ID,
        tenantId: TENANT_CODE,
        commentId: 'comment-9',
        at: ENDED_AT,
      });

      expect(awardsPassed()[0]).toMatchObject({
        rule: XP_RULE.PEER_COMMENT,
        sourceType: XP_SOURCE_TYPE.PEER_COMMENT,
        sourceId: 'comment-9',
        xp: XP_AWARD.PER_PEER_COMMENT,
      });
    });

    it('grants nothing once the peer cap is spent', async () => {
      xpEventRepository.getXpAwardedOn.mockImplementation(
        async (_m, _u, _t, _d, rules: readonly string[]) =>
          rules.includes(XP_RULE.PEER_COMMENT) ? 15 : 0,
      );
      await service.awardForPeerComment({
        userId: USER_ID,
        tenantId: TENANT_CODE,
        commentId: 'comment-10',
        at: ENDED_AT,
      });

      expect(awardsPassed()[0].xp).toBe(0);
    });
  });

  describe('weekly consistency', () => {
    /** The consistency write is the second insertAwards call after a session. */
    const consistencyCall = () =>
      xpEventRepository.insertAwards.mock.calls.find((call) =>
        (call[4] as { rule: string }[]).some(
          (award) => award.rule === XP_RULE.WEEKLY_CONSISTENCY,
        ),
      );

    it('pays once a fourth qualifying day lands', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(1);
      xpEventRepository.countQualifyingDaysBetween.mockResolvedValue(
        WEEKLY_CONSISTENCY_DAYS,
      );
      await awardSession(10 * 60 * 1000);

      const call = consistencyCall();
      expect(call).toBeDefined();
      expect((call?.[4] as { xp: number }[])[0].xp).toBe(
        XP_AWARD.WEEKLY_CONSISTENCY,
      );
    });

    it('does not pay below the threshold', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(1);
      xpEventRepository.countQualifyingDaysBetween.mockResolvedValue(
        WEEKLY_CONSISTENCY_DAYS - 1,
      );
      await awardSession(10 * 60 * 1000);

      expect(consistencyCall()).toBeUndefined();
    });

    it('does not pay twice in the same week', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(1);
      xpEventRepository.countQualifyingDaysBetween.mockResolvedValue(7);
      xpEventRepository.hasAward.mockResolvedValue(true);
      await awardSession(10 * 60 * 1000);

      expect(consistencyCall()).toBeUndefined();
    });

    it('excludes the bonus rules from the qualifying-day count, so it cannot feed itself', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(1);
      xpEventRepository.countQualifyingDaysBetween.mockResolvedValue(
        WEEKLY_CONSISTENCY_DAYS,
      );
      await awardSession(10 * 60 * 1000);

      const excluded = xpEventRepository.countQualifyingDaysBetween.mock
        .calls[0][5] as readonly string[];
      expect(excluded).toContain(XP_RULE.WEEKLY_CONSISTENCY);
      expect(excluded).toContain(XP_RULE.DAILY_DEPTH_MILESTONE);
    });

    it('pays in full even on a day that is already at the ceiling', async () => {
      xpEventRepository.insertAwards.mockResolvedValue(1);
      xpEventRepository.getCappedXpAwardedOn.mockResolvedValue(
        DAILY_XP_CEILING,
      );
      xpEventRepository.countQualifyingDaysBetween.mockResolvedValue(
        WEEKLY_CONSISTENCY_DAYS,
      );
      await awardSession(10 * 60 * 1000);

      expect((consistencyCall()?.[4] as { xp: number }[])[0].xp).toBe(
        XP_AWARD.WEEKLY_CONSISTENCY,
      );
    });
  });
});
