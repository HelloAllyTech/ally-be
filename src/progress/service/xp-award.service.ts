import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager } from 'typeorm';
import {
  businessWeekBounds,
  toBusinessDateString,
  toBusinessWeekKey,
} from 'src/common/util/date.util';
import { ProgressTenantResolver } from './progress-tenant.resolver';
import { UserProgressRepository } from '../repository/user-progress.repository';
import { SessionEngagementRepository } from '../repository/session-engagement.repository';
import {
  XpAwardRow,
  XpEventRepository,
} from '../repository/xp-event.repository';
import {
  DAILY_SOURCE_CAPS,
  DAILY_XP_CEILING,
  depthMilestonesCrossed,
  LevelUpEvent,
  NON_QUALIFYING_RULES,
  practiceXpForSession,
  PROGRESS_EVENTS,
  resolveLevel,
  trackItemXp,
  UNCAPPED_RULES,
  WEEKLY_CONSISTENCY_DAYS,
  XP_AWARD,
  XP_RULE,
  XP_SOURCE_TYPE,
  XpAwardedEvent,
} from '../progress.constants';

/** Per-rule cap lookup, built once from the declarative table. */
const CAP_FOR_RULE = new Map<string, { name: string; cap: number }>(
  DAILY_SOURCE_CAPS.flatMap((source) =>
    source.rules.map(
      (rule) =>
        [rule, { name: source.name, cap: source.cap }] as [
          string,
          { name: string; cap: number },
        ],
    ),
  ),
);

/**
 * Spends one learner-day's XP allowance across several awards.
 *
 * Reads the day's spend once, then allocates in memory. Doing it per award instead
 * would let a batch overshoot: every award in a session-end batch would read the same
 * pre-insert totals, each see the full remaining allowance, and together exceed both
 * the source cap and the daily ceiling.
 *
 * Not concurrency-safe on its own — the caller holds `lockUserDay` for the transaction,
 * which is what makes the read-then-allocate sequence sound against a second writer.
 */
class DailyAllocator {
  constructor(
    private readonly groupSpent: Map<string, number>,
    private ceilingSpent: number,
  ) {}

  /** Grants as much of `requested` as today's caps allow, and records the spend. */
  take(rule: string, requested: number): number {
    if (requested <= 0) return 0;

    // Rules outside the daily ceiling pay for a pattern across a longer period than the
    // day they land on, so a full day must not silently swallow them.
    if (UNCAPPED_RULES.includes(rule)) return requested;

    const source = CAP_FOR_RULE.get(rule);
    let allowed = requested;

    if (source) {
      const spent = this.groupSpent.get(source.name) ?? 0;
      allowed = Math.min(allowed, Math.max(0, source.cap - spent));
    }
    allowed = Math.min(
      allowed,
      Math.max(0, DAILY_XP_CEILING - this.ceilingSpent),
    );
    if (allowed <= 0) return 0;

    if (source) {
      this.groupSpent.set(
        source.name,
        (this.groupSpent.get(source.name) ?? 0) + allowed,
      );
    }
    this.ceilingSpent += allowed;
    return allowed;
  }
}

/**
 * Writes XP.
 *
 * Every public method is safe to call twice with the same source. The ledger's unique
 * index absorbs the duplicate and the rollup is incremented only by what actually
 * inserted, so a redelivered session-end or a re-run backfill adds nothing.
 *
 * Callers must never let a failure here break the flow that triggered it — earning XP
 * is a reward, not a precondition — so every entry point swallows and logs. Because
 * that makes a silently-dead source indistinguishable from an idle one, each entry
 * point also logs what it actually awarded, so a rule that stops firing is visible
 * rather than merely absent from the ledger.
 */
@Injectable()
export class XpAwardService {
  private readonly logger = new Logger(XpAwardService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly xpEventRepository: XpEventRepository,
    private readonly userProgressRepository: UserProgressRepository,
    private readonly sessionEngagementRepository: SessionEngagementRepository,
    private readonly tenantResolver: ProgressTenantResolver,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * XP for a finished roleplay session: practice minutes, the completion award, and any
   * daily depth milestone the session pushed the learner past.
   *
   * Call this only after winning the IN_PROGRESS -> COMPLETED compare-and-set that
   * licenses the other end-of-session side effects. Called before it, a losing writer
   * would award XP for a session it did not finalise.
   *
   * A session recovered by the unfinalised-session sweeper has no score, which no longer
   * matters — XP v2 never reads the score. What it must still have is turns: the learner
   * either did the practice or they did not, and the sweeper does not change that.
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

      const learnerTurns =
        await this.sessionEngagementRepository.countLearnerTurns(
          scenarioSessionId,
        );

      const { minuteXp, completionXp } = practiceXpForSession(
        durationMs / 1000,
        learnerTurns,
      );
      if (minuteXp === 0 && completionXp === 0) {
        this.logger.log(
          `[XP] session ${scenarioSessionId} earned nothing: ` +
            `durationSec=${Math.round(durationMs / 1000)} learnerTurns=${learnerTurns}`,
        );
        return;
      }

      await this.dataSource.transaction(async (manager) => {
        await this.xpEventRepository.lockUserDay(
          manager,
          userId,
          tenantId,
          awardedOn,
        );

        const minutesBefore =
          await this.xpEventRepository.getPracticeMinutesAwardedOn(
            manager,
            userId,
            tenantId,
            awardedOn,
          );
        const allocator = await this.openAllocator(
          manager,
          userId,
          tenantId,
          awardedOn,
        );

        const grantedMinuteXp = allocator.take(
          XP_RULE.PRACTICE_MINUTE,
          minuteXp,
        );

        // Milestones fire off minutes actually paid for, not minutes played. A learner
        // already at the practice cap has stopped accruing toward depth as well —
        // otherwise the cap would be bypassable by way of the milestone bonuses.
        const milestones = depthMilestonesCrossed(
          minutesBefore,
          minutesBefore + grantedMinuteXp,
        );

        const awards: XpAwardRow[] = [
          {
            rule: XP_RULE.PRACTICE_MINUTE,
            sourceType: XP_SOURCE_TYPE.SCENARIO_SESSION,
            sourceId: scenarioSessionId,
            xp: grantedMinuteXp,
          },
          {
            rule: XP_RULE.SESSION_COMPLETED,
            sourceType: XP_SOURCE_TYPE.SCENARIO_SESSION,
            sourceId: scenarioSessionId,
            xp: allocator.take(XP_RULE.SESSION_COMPLETED, completionXp),
          },
          ...milestones.map((milestone) => ({
            rule: XP_RULE.DAILY_DEPTH_MILESTONE,
            sourceType: XP_SOURCE_TYPE.DAY,
            sourceId: `${awardedOn}:${milestone.minutes}`,
            xp: allocator.take(XP_RULE.DAILY_DEPTH_MILESTONE, milestone.xp),
          })),
        ];

        const awarded = await this.commit(
          manager,
          userId,
          tenantId,
          awardedOn,
          awards,
          endedAt,
        );
        this.logAwardOutcome('session', scenarioSessionId, awarded);
      });

      await this.awardWeeklyConsistency({ userId, tenantId, at: endedAt });
    } catch (error) {
      this.logger.error(
        `Failed to award session XP for user ${userId} session ${scenarioSessionId}: ${error}`,
      );
    }
  }

  /**
   * XP for completing one track item, weighted by component type. Idempotent on the
   * item id.
   *
   * ROLEPLAY items are weighted at zero and drop out here — their session already paid
   * practice minutes and a completion award, and paying the item as well double-counted
   * roleplay against every other component type.
   */
  async awardForTrackItem(params: {
    userId: number;
    tenantId: string;
    trackItemId: string;
    itemType?: string;
  }): Promise<void> {
    const { userId, trackItemId, itemType } = params;

    const xp = trackItemXp(itemType);
    if (xp === 0) return;

    await this.awardOne({
      userId,
      rawTenantId: params.tenantId,
      rule: XP_RULE.TRACK_ITEM_COMPLETED,
      sourceType: XP_SOURCE_TYPE.TRACK_ITEM,
      sourceId: trackItemId,
      xp,
      at: new Date(),
      label: `track:${itemType}`,
    });
  }

  /**
   * XP for a substantive debrief conversation, once per session.
   *
   * The caller decides what "substantive" means and only calls when it is met; this
   * method's job is to pay for it at most once. Keyed on the session, so a learner who
   * keeps replying is not paid again.
   */
  async awardForDebriefThread(params: {
    userId: number;
    tenantId: string;
    scenarioSessionId: string;
    at?: Date;
  }): Promise<void> {
    await this.awardOne({
      userId: params.userId,
      rawTenantId: params.tenantId,
      rule: XP_RULE.DEBRIEF_THREAD,
      sourceType: XP_SOURCE_TYPE.DEBRIEF,
      sourceId: params.scenarioSessionId,
      xp: XP_AWARD.PER_DEBRIEF_THREAD,
      at: params.at ?? new Date(),
      label: 'debrief',
    });
  }

  /**
   * XP for one substantive comment on a peer's session.
   *
   * The softest signal in the model: comments are cheap to produce and hard to judge,
   * so it is bounded twice over — the caller applies a substance floor before calling,
   * and the peer cap bounds what gets through anyway.
   */
  async awardForPeerComment(params: {
    userId: number;
    tenantId: string;
    commentId: string;
    at?: Date;
  }): Promise<void> {
    await this.awardOne({
      userId: params.userId,
      rawTenantId: params.tenantId,
      rule: XP_RULE.PEER_COMMENT,
      sourceType: XP_SOURCE_TYPE.PEER_COMMENT,
      sourceId: params.commentId,
      xp: XP_AWARD.PER_PEER_COMMENT,
      at: params.at ?? new Date(),
      label: 'peer-comment',
    });
  }

  /**
   * The shape every single-award source shares: resolve the tenant, lock the day, spend
   * against the caps, write, then re-check weekly consistency.
   */
  private async awardOne(params: {
    userId: number;
    rawTenantId: string;
    rule: string;
    sourceType: string;
    sourceId: string;
    xp: number;
    at: Date;
    label: string;
  }): Promise<void> {
    const { userId, rule, sourceType, sourceId, xp, at, label } = params;

    try {
      const tenantId = await this.tenantResolver.toCanonicalId(
        params.rawTenantId,
      );
      const awardedOn = toBusinessDateString(at);

      await this.dataSource.transaction(async (manager) => {
        await this.xpEventRepository.lockUserDay(
          manager,
          userId,
          tenantId,
          awardedOn,
        );
        const allocator = await this.openAllocator(
          manager,
          userId,
          tenantId,
          awardedOn,
        );

        const awarded = await this.commit(
          manager,
          userId,
          tenantId,
          awardedOn,
          [
            {
              rule,
              sourceType,
              sourceId,
              xp: allocator.take(rule, xp),
            },
          ],
          at,
        );
        this.logAwardOutcome(label, sourceId, awarded);
      });

      await this.awardWeeklyConsistency({ userId, tenantId, at });
    } catch (error) {
      this.logger.error(
        `Failed to award ${label} XP for user ${userId} source ${sourceId}: ${error}`,
      );
    }
  }

  /**
   * Pays the weekly consistency bonus the moment a fourth qualifying day banks XP.
   *
   * Evaluated on write rather than on a schedule, so the learner is told the same day
   * they earn it and there is no job to fail silently.
   *
   * Two things keep it from feeding itself. Qualifying days exclude the bonus rules
   * (NON_QUALIFYING_RULES), so only work actually done advances a learner toward it; and
   * the award sits outside the daily ceiling, because it pays for a pattern across the
   * week rather than for anything done on the day it lands.
   *
   * `tenantId` must already be canonical — every caller resolves it first.
   */
  private async awardWeeklyConsistency(params: {
    userId: number;
    tenantId: string;
    at: Date;
  }): Promise<void> {
    const { userId, tenantId, at } = params;

    try {
      const weekKey = toBusinessWeekKey(at);
      const { start, end } = businessWeekBounds(at);
      const awardedOn = toBusinessDateString(at);

      await this.dataSource.transaction(async (manager) => {
        // Same lock as the daily caps: two awards landing together must not both read
        // three qualifying days, both see a fourth, and both try to pay.
        await this.xpEventRepository.lockUserDay(
          manager,
          userId,
          tenantId,
          awardedOn,
        );

        const already = await this.xpEventRepository.hasAward(
          manager,
          userId,
          tenantId,
          XP_RULE.WEEKLY_CONSISTENCY,
          XP_SOURCE_TYPE.WEEK,
          weekKey,
        );
        if (already) return;

        const qualifyingDays =
          await this.xpEventRepository.countQualifyingDaysBetween(
            manager,
            userId,
            tenantId,
            start,
            end,
            NON_QUALIFYING_RULES,
          );
        if (qualifyingDays < WEEKLY_CONSISTENCY_DAYS) return;

        const awarded = await this.commit(
          manager,
          userId,
          tenantId,
          awardedOn,
          [
            {
              rule: XP_RULE.WEEKLY_CONSISTENCY,
              sourceType: XP_SOURCE_TYPE.WEEK,
              sourceId: weekKey,
              xp: XP_AWARD.WEEKLY_CONSISTENCY,
            },
          ],
          at,
        );
        this.logAwardOutcome('weekly-consistency', weekKey, awarded);
      });
    } catch (error) {
      this.logger.error(
        `Failed to award weekly consistency for user ${userId}: ${error}`,
      );
    }
  }

  /**
   * Reads today's spend per source group and against the ceiling, once.
   *
   * The caller must already hold `lockUserDay` on the same transaction.
   */
  private async openAllocator(
    manager: EntityManager,
    userId: number,
    tenantId: string,
    awardedOn: string,
  ): Promise<DailyAllocator> {
    const groupSpent = new Map<string, number>();
    for (const source of DAILY_SOURCE_CAPS) {
      groupSpent.set(
        source.name,
        await this.xpEventRepository.getXpAwardedOn(
          manager,
          userId,
          tenantId,
          awardedOn,
          source.rules,
        ),
      );
    }

    const ceilingSpent = await this.xpEventRepository.getCappedXpAwardedOn(
      manager,
      userId,
      tenantId,
      awardedOn,
      UNCAPPED_RULES,
    );

    return new DailyAllocator(groupSpent, ceilingSpent);
  }

  /**
   * Writes the ledger rows and the rollup together, then announces the result.
   *
   * Events are emitted after the transaction callback returns its value but while the
   * caller still holds the transaction, which is deliberate: listeners award badges and
   * must not run against a rollup that later rolls back.
   *
   * Returns the XP actually written, so callers can log a source that awarded nothing.
   */
  private async commit(
    manager: EntityManager,
    userId: number,
    tenantId: string,
    awardedOn: string,
    awards: XpAwardRow[],
    at: Date,
  ): Promise<number> {
    const awarded = await this.xpEventRepository.insertAwards(
      manager,
      userId,
      tenantId,
      awardedOn,
      awards,
    );
    if (awarded === 0) return 0;

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

    return awarded;
  }

  /**
   * One line per award attempt, so a source that has stopped firing is visible.
   *
   * Every entry point swallows its errors by design, which means a broken source and an
   * idle one look identical in the ledger. This is the difference between them.
   */
  private logAwardOutcome(
    source: string,
    sourceId: string,
    awarded: number,
  ): void {
    this.logger.log(`[XP] source=${source} id=${sourceId} awarded=${awarded}`);
  }
}
