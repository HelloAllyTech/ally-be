import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager } from 'typeorm';
import { toBusinessDateString } from 'src/common/util/date.util';
import { CommunitySharedService } from 'src/community/service/community-shared.service';
import { ProgressTenantResolver } from './progress-tenant.resolver';
import { UserProgressRepository } from '../repository/user-progress.repository';
import {
  XpAwardRow,
  XpEventRepository,
} from '../repository/xp-event.repository';
import {
  DAILY_PRACTICE_XP_CAP,
  DAILY_SKILL_PERSONAL_BEST_CAP,
  LevelUpEvent,
  practiceXpForSession,
  PROGRESS_EVENTS,
  resolveLevel,
  XP_AWARD,
  XP_RULE,
  XP_SOURCE_TYPE,
  XpAwardedEvent,
} from '../progress.constants';

/**
 * Writes XP.
 *
 * Every public method is safe to call twice with the same source. The ledger's unique
 * index absorbs the duplicate and the rollup is incremented only by what actually
 * inserted, so a redelivered session-end or a re-run backfill adds nothing.
 *
 * Callers must never let a failure here break the flow that triggered it — earning XP
 * is a reward, not a precondition — so every entry point swallows and logs.
 */
@Injectable()
export class XpAwardService {
  private readonly logger = new Logger(XpAwardService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly xpEventRepository: XpEventRepository,
    private readonly userProgressRepository: UserProgressRepository,
    private readonly communitySharedService: CommunitySharedService,
    private readonly tenantResolver: ProgressTenantResolver,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * XP for a finished roleplay session.
   *
   * Call this only after winning the IN_PROGRESS -> COMPLETED compare-and-set that
   * licenses the other end-of-session side effects. Called before it, a losing writer
   * would award XP for a session it did not finalise.
   *
   * A session recovered by the unfinalised-session sweeper has no score and still
   * earns the duration and completion awards: the learner did the practice, and the
   * missing score is a platform fault rather than anything they did.
   */
  async awardForSession(params: {
    userId: number;
    tenantId: string;
    scenarioSessionId: string;
    durationMs: number;
    endedAt: Date;
  }): Promise<void> {
    const { userId, scenarioSessionId, durationMs, endedAt } = params;

    try {
      const tenantId = await this.tenantResolver.toCanonicalId(params.tenantId);
      const awardedOn = toBusinessDateString(endedAt);
      const streakDays = await this.streakDaysIncludingToday(
        userId,
        tenantId,
        awardedOn,
      );

      const { minuteXp, streakBonusXp, completionXp } = practiceXpForSession(
        durationMs / 1000,
        streakDays,
      );
      if (minuteXp === 0 && completionXp === 0) return;

      await this.dataSource.transaction(async (manager) => {
        const alreadyToday =
          await this.xpEventRepository.getPracticeXpAwardedOn(
            manager,
            userId,
            tenantId,
            awardedOn,
          );
        const allowance = Math.max(0, DAILY_PRACTICE_XP_CAP - alreadyToday);

        const cappedMinuteXp = Math.min(minuteXp, allowance);
        const cappedStreakXp = Math.min(
          streakBonusXp,
          allowance - cappedMinuteXp,
        );

        const awards: XpAwardRow[] = [
          {
            rule: XP_RULE.PRACTICE_MINUTE,
            sourceType: XP_SOURCE_TYPE.SCENARIO_SESSION,
            sourceId: scenarioSessionId,
            xp: cappedMinuteXp,
          },
          {
            rule: XP_RULE.STREAK_MULTIPLIER,
            sourceType: XP_SOURCE_TYPE.SCENARIO_SESSION,
            sourceId: scenarioSessionId,
            xp: cappedStreakXp,
          },
          {
            rule: XP_RULE.SESSION_COMPLETED,
            sourceType: XP_SOURCE_TYPE.SCENARIO_SESSION,
            sourceId: scenarioSessionId,
            xp: completionXp,
          },
        ];

        await this.commit(
          manager,
          userId,
          tenantId,
          awardedOn,
          awards,
          endedAt,
        );
      });
    } catch (error) {
      this.logger.error(
        `Failed to award session XP for user ${userId} session ${scenarioSessionId}: ${error}`,
      );
    }
  }

  /** XP for completing one track item. Idempotent on the item id. */
  async awardForTrackItem(params: {
    userId: number;
    tenantId: string;
    trackItemId: string;
  }): Promise<void> {
    const { userId, trackItemId } = params;

    try {
      const tenantId = await this.tenantResolver.toCanonicalId(params.tenantId);
      const now = new Date();
      const awardedOn = toBusinessDateString(now);

      await this.dataSource.transaction(async (manager) => {
        await this.commit(
          manager,
          userId,
          tenantId,
          awardedOn,
          [
            {
              rule: XP_RULE.TRACK_ITEM_COMPLETED,
              sourceType: XP_SOURCE_TYPE.TRACK_ITEM,
              sourceId: trackItemId,
              xp: XP_AWARD.PER_TRACK_ITEM_COMPLETED,
            },
          ],
          now,
        );
      });
    } catch (error) {
      this.logger.error(
        `Failed to award track item XP for user ${userId} item ${trackItemId}: ${error}`,
      );
    }
  }

  /**
   * XP for beating a previous best on a skill, capped at one per day so a learner
   * cannot farm it by replaying the same short scenario.
   */
  async awardSkillPersonalBest(params: {
    userId: number;
    tenantId: string;
    scenarioSessionId: string;
  }): Promise<void> {
    const { userId, scenarioSessionId } = params;

    try {
      const tenantId = await this.tenantResolver.toCanonicalId(params.tenantId);
      const now = new Date();
      const awardedOn = toBusinessDateString(now);

      await this.dataSource.transaction(async (manager) => {
        const already =
          await this.xpEventRepository.countPersonalBestsAwardedOn(
            manager,
            userId,
            tenantId,
            awardedOn,
          );
        if (already >= DAILY_SKILL_PERSONAL_BEST_CAP) return;

        await this.commit(
          manager,
          userId,
          tenantId,
          awardedOn,
          [
            {
              rule: XP_RULE.SKILL_PERSONAL_BEST,
              sourceType: XP_SOURCE_TYPE.SCENARIO_SESSION,
              sourceId: scenarioSessionId,
              xp: XP_AWARD.PER_SKILL_PERSONAL_BEST,
            },
          ],
          now,
        );
      });
    } catch (error) {
      this.logger.error(
        `Failed to award personal-best XP for user ${userId}: ${error}`,
      );
    }
  }

  /**
   * Writes the ledger rows and the rollup together, then announces the result.
   *
   * Events are emitted after the transaction callback returns its value but while the
   * caller still holds the transaction, which is deliberate: listeners award badges and
   * must not run against a rollup that later rolls back.
   */
  private async commit(
    manager: EntityManager,
    userId: number,
    tenantId: string,
    awardedOn: string,
    awards: XpAwardRow[],
    at: Date,
  ): Promise<void> {
    const awarded = await this.xpEventRepository.insertAwards(
      manager,
      userId,
      tenantId,
      awardedOn,
      awards,
    );
    if (awarded === 0) return;

    const { totalXp, previousLevel } = await this.userProgressRepository.addXp(
      manager,
      userId,
      tenantId,
      awarded,
      at,
    );

    const { level } = resolveLevel(totalXp);
    const leveledUp = level > previousLevel;
    if (level !== previousLevel) {
      await this.userProgressRepository.setLevel(
        manager,
        userId,
        tenantId,
        level,
        leveledUp,
        at,
      );
    }

    this.eventEmitter.emit(PROGRESS_EVENTS.XP_AWARDED, {
      userId,
      tenantId,
      xp: awarded,
      totalXp,
      level,
    } as XpAwardedEvent);

    if (leveledUp) {
      this.eventEmitter.emit(PROGRESS_EVENTS.LEVEL_UP, {
        userId,
        tenantId,
        previousLevel,
        level,
      } as LevelUpEvent);
    }
  }

  /**
   * The streak length to price today's practice against.
   *
   * `getStreakStatsForUser` reads persisted daily scores, and today's row is written by
   * a separate listener on the same session-end event, so it may not exist yet. The
   * learner has demonstrably practised today — that is why we are here — so today is
   * counted explicitly rather than waiting for the write to land.
   */
  private async streakDaysIncludingToday(
    userId: number,
    tenantId: string,
    businessToday: string,
  ): Promise<number> {
    const stats = await this.communitySharedService.getStreakStatsForUser(
      userId,
      tenantId,
      businessToday,
    );
    if (stats.lastActiveDate === businessToday) return stats.currentStreak;
    return stats.currentStreak + 1;
  }
}
