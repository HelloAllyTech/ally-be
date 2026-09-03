import { ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PreferenceName } from 'src/common/constants/user.constants';
import { TenantFeatureService } from 'src/authorization/service/tenant-feature.service';
import { CommunitySharedService } from 'src/community/service/community-shared.service';
import { ProgressTenantResolver } from './progress-tenant.resolver';
import { UserProgressRepository } from '../repository/user-progress.repository';
import {
  LevelThresholdDto,
  ProgressResponseDto,
  ProgressSummaryDto,
} from '../dto/progress.dto';
import { LEVEL_THRESHOLDS, resolveLevel, XP_RULE } from '../progress.constants';

@Injectable()
export class ProgressService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly userProgressRepository: UserProgressRepository,
    private readonly communitySharedService: CommunitySharedService,
    private readonly tenantFeatureService: TenantFeatureService,
    private readonly tenantResolver: ProgressTenantResolver,
  ) {}

  /**
   * Whether the learner's org has the Progress dashboard switched on.
   *
   * Exposed so a client can decide whether to render the nav indicator at all, rather
   * than discovering the answer from a 403 on a request it should not have made.
   */
  async isEnabledForTenant(tenantId: string): Promise<boolean> {
    return this.tenantFeatureService.isEnabledForTenant(
      PreferenceName.PROGRESS_DASHBOARD_ENABLED,
      tenantId,
    );
  }

  async getSummary(
    userId: number,
    tenantIdentifier: string,
  ): Promise<ProgressSummaryDto> {
    await this.assertEnabled(tenantIdentifier);
    const tenantId = await this.tenantResolver.toCanonicalId(tenantIdentifier);
    return this.buildSummary(userId, tenantId);
  }

  async getProgress(
    userId: number,
    tenantIdentifier: string,
  ): Promise<ProgressResponseDto> {
    await this.assertEnabled(tenantIdentifier);
    const tenantId = await this.tenantResolver.toCanonicalId(tenantIdentifier);

    const [summary, totals, lifetimePracticeMinutes, counts] =
      await Promise.all([
        this.buildSummary(userId, tenantId),
        this.userProgressRepository.findTotals(userId, tenantId),
        this.getLifetimePracticeMinutes(userId, tenantId),
        this.getCompletionCounts(userId, tenantId),
      ]);

    return {
      ...summary,
      lifetimePracticeMinutes,
      sessionsCompleted: counts.sessionsCompleted,
      trackItemsCompleted: counts.trackItemsCompleted,
      ladder: this.ladder(),
      lastLevelUpAt: totals?.lastLevelUpAt ?? null,
    };
  }

  /**
   * A learner with no XP yet has no rollup row, which is the normal state on day one
   * rather than an error. Level 1 with an empty bar is the correct answer.
   */
  private async buildSummary(
    userId: number,
    tenantId: string,
  ): Promise<ProgressSummaryDto> {
    const totals = await this.userProgressRepository.findTotals(
      userId,
      tenantId,
    );
    const standing = resolveLevel(totals?.totalXp ?? 0);

    return {
      level: standing.level,
      totalXp: totals?.totalXp ?? 0,
      xpIntoLevel: standing.xpIntoLevel,
      xpToNextLevel: standing.xpToNextLevel,
      nextLevelXp: standing.nextLevelXp,
      progress: standing.progress,
      isMaxLevel: standing.isMaxLevel,
    };
  }

  /**
   * Read from `user_daily_scores`, the sanctioned roleplay-activity source, and
   * tenant-scoped so a learner who belongs to two orgs sees the minutes for the one
   * they are signed into.
   */
  private async getLifetimePracticeMinutes(
    userId: number,
    tenantId: string,
  ): Promise<number> {
    const rows =
      await this.communitySharedService.getTotalSimulationMinutesPerUser(
        [tenantId],
        [userId],
      );
    return Math.floor(Number(rows[0]?.totalMinutes ?? 0));
  }

  /**
   * Counted from the ledger rather than from sessions and track progress directly, so
   * the numbers on the screen always agree with the XP that produced them.
   */
  private async getCompletionCounts(
    userId: number,
    tenantId: string,
  ): Promise<{ sessionsCompleted: number; trackItemsCompleted: number }> {
    const rows: { rule: string; count: string }[] = await this.dataSource.query(
      `SELECT "rule", COUNT(*)::int AS count FROM "xp_events" ` +
        `WHERE "userId" = $1 AND "tenant_id" = $2 AND "rule" = ANY($3::character varying[]) ` +
        `GROUP BY "rule"`,
      [
        userId,
        tenantId,
        [XP_RULE.SESSION_COMPLETED, XP_RULE.TRACK_ITEM_COMPLETED],
      ],
    );

    const byRule = new Map(rows.map((row) => [row.rule, Number(row.count)]));
    return {
      sessionsCompleted: byRule.get(XP_RULE.SESSION_COMPLETED) ?? 0,
      trackItemsCompleted: byRule.get(XP_RULE.TRACK_ITEM_COMPLETED) ?? 0,
    };
  }

  private ladder(): LevelThresholdDto[] {
    return LEVEL_THRESHOLDS.map((requiredXp, index) => ({
      level: index + 1,
      requiredXp,
    }));
  }

  private async assertEnabled(tenantId: string): Promise<void> {
    if (!(await this.isEnabledForTenant(tenantId))) {
      throw new ForbiddenException(
        'The Progress dashboard is not enabled for this organisation',
      );
    }
  }
}
