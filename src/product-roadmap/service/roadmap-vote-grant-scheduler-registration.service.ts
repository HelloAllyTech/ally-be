import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { LoggerService } from '../../logger/logger.service';
import { SUPER_ADMIN_ROLES } from '../../common/constants/user.constants';
import { RoadmapVoteGrantRepository } from '../repository/roadmap-vote-grant.repository';
import { currentDayKey, currentPeriodKey } from '../util/roadmap-period.util';

/**
 * Issues the recurring vote grants — 5/day, 50/month — to every roadmap-eligible platform
 * admin. See RoadmapVoteGrant's docblock for the ledger this feeds.
 *
 * ELIGIBILITY = SUPER_ADMIN_ROLES ([SUPER_ADMIN, SUPER_DUPER_ADMIN]), not the broader
 * PLATFORM_TIER_ROLES. Deliberate: that's the exact pair of groups migration
 * 1871000000003 grants `vote:admin:product-roadmap` to — the roadmap's permission grant was
 * never re-pointed at PLATFORM_ADMIN when the role collapse landed, so PLATFORM_ADMIN-only
 * accounts hold no roadmap vote permission today regardless of this job. Matching that exactly
 * (rather than reaching for PLATFORM_TIER_ROLES, which answers "is this a staff account?" —
 * a different question, see the ally-super-admin-roles-staleness-trap history) keeps grant
 * issuance from drifting out of sync with who can actually spend them.
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
         INNER JOIN groups g ON g.id = ug."groupId"
        WHERE g.name = ANY($1::text[])`,
      [SUPER_ADMIN_ROLES],
    );
    return rows.map((r) => r.userId);
  }
}
