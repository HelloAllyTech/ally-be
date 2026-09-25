import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { LoggerService } from '../../logger/logger.service';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { RoadmapVoteGrantRepository } from '../repository/roadmap-vote-grant.repository';
import { currentDayKey, currentPeriodKey } from '../util/roadmap-period.util';

/**
 * Issues the recurring vote grants — 5/day, 50/month — to every roadmap-eligible platform
 * admin. See RoadmapVoteGrant's docblock for the ledger this feeds.
 *
 * ELIGIBILITY = every user in a group that holds `vote:admin:product-roadmap` — the exact
 * permission PUT /allocations checks — so issuance can't drift out of sync with who can
 * actually spend a grant. Keyed on the permission, not on group names, on purpose: this used
 * to list SUPER_ADMIN_ROLES, which names only the two retired super-admin tiers. The role
 * collapse (CreatePlatformAdminRole1895000000001) copied SUPER_DUPER_ADMIN's permissions onto
 * PLATFORM_ADMIN, and the Ally admins screen grants PLATFORM_ADMIN and nothing else, so every
 * admin added since could vote but was never issued a single vote to vote with.
 * BackfillRoadmapVoteGrantsForPlatformAdmins1973410000000 repaired the grants they missed.
 */
@Injectable()
export class RoadmapVoteGrantSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    RoadmapVoteGrantSchedulerRegistrationService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly grantRepository: RoadmapVoteGrantRepository,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('daily', 'roadmap-vote-grant-daily', () =>
      this.issueDailyGrants(),
    );
    scheduledTaskRegistry.register(
      'monthly',
      'roadmap-vote-grant-monthly',
      () => this.issueMonthlyGrants(),
    );
  }

  async issueDailyGrants(): Promise<void> {
    const dayKey = currentDayKey();
    const userIds = await this.eligibleUserIds();
    for (const userId of userIds) {
      await this.grantRepository.grantDaily(
        this.dataSource.manager,
        userId,
        dayKey,
      );
    }
    this.logger.debug(
      `Issued daily roadmap vote grants (${dayKey}) to ${userIds.length} user(s)`,
    );
  }

  async issueMonthlyGrants(): Promise<void> {
    const periodKey = currentPeriodKey();
    const userIds = await this.eligibleUserIds();
    for (const userId of userIds) {
      await this.grantRepository.grantMonthly(
        this.dataSource.manager,
        userId,
        periodKey,
      );
    }
    this.logger.debug(
      `Issued monthly roadmap vote grants (${periodKey}) to ${userIds.length} user(s)`,
    );
  }

  private async eligibleUserIds(): Promise<number[]> {
    const rows = await this.dataSource.query<{ userId: number }[]>(
      `SELECT DISTINCT ug."userId"
         FROM user_groups ug
         INNER JOIN group_permissions gp ON gp."groupId" = ug."groupId"
         INNER JOIN permissions p ON p.id = gp."permissionId"
        WHERE p.name = $1`,
      [PERMISSIONS.VOTE_PRODUCT_ROADMAP],
    );
    return rows.map((r) => r.userId);
  }
}
