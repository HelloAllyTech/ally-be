import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { InAppNotificationService } from 'src/notification/service/in-app-notification.service';
import { DeviceTokenService } from 'src/notification/service/device-token.service';
import { PushService } from 'src/notification/service/push.service';
import {
  ENGAGEMENT_REMINDER_TYPE,
  INACTIVITY_DAYS_THRESHOLD,
  REMINDER_BODY,
  REMINDER_COOLDOWN_DAYS,
  REMINDER_TITLE,
} from '../constant/engagement-reminder.constant';

interface EligibleLearner {
  userId: number;
}

@Injectable()
export class EngagementReminderEvaluatorService {
  private static readonly logger = LoggerService.getInstance(
    EngagementReminderEvaluatorService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly notificationService: InAppNotificationService,
    private readonly deviceTokenService: DeviceTokenService,
    private readonly pushService: PushService,
  ) {}

  /**
   * Entry point for the hourly scheduled task. Unlike `StreakReminderService`
   * this isn't pinned to one hour of the business day — disengagement is an
   * inactivity threshold, not a daily deadline, so every hourly tick is a
   * valid time to catch learners who just crossed it. The runner's own
   * per-interval advisory lock (`ScheduledTaskRunnerService`) already
   * prevents two replicas double-running this tick, so no extra Redis lock
   * is needed here.
   */
  async evaluate(): Promise<void> {
    const tenantIds = await this.getOptedInTenantIds();
    if (!tenantIds.length) {
      return;
    }

    for (const tenantId of tenantIds) {
      try {
        const learners = await this.getEligibleLearners(tenantId);
        if (!learners.length) {
          continue;
        }
        const sent = await this.sendReminders(tenantId, learners);
        EngagementReminderEvaluatorService.logger.info(
          `Engagement reminders for tenant ${tenantId}: ${sent}/${learners.length} sent`,
        );
      } catch (error) {
        EngagementReminderEvaluatorService.logger.error(
          `Failed sending engagement reminders for tenant ${tenantId}: ${error.message}`,
        );
      }
    }
  }

  /** Tenants that have explicitly opted in. Default is off. */
  private async getOptedInTenantIds(): Promise<string[]> {
    const rows = await this.dataSource.query(
      `
      SELECT id
      FROM tenants
      WHERE "deletedAt" IS NULL
        AND COALESCE(settings->'engagementReminder'->>'remindersEnabled', 'false') = 'true'
      `,
    );
    return rows.map((row: { id: string }) => row.id);
  }

  /**
   * Learners inactive for at least `INACTIVITY_DAYS_THRESHOLD` days who
   * haven't already received a reminder within `REMINDER_COOLDOWN_DAYS` —
   * the `NOT EXISTS` against `in_app_notifications` is both the cooldown
   * check and the only "delivery record" this feature needs.
   */
  private async getEligibleLearners(
    tenantId: string,
  ): Promise<EligibleLearner[]> {
    const rows = await this.dataSource.query(
      `
      SELECT u.id AS "userId"
      FROM users u
      WHERE u.tenant_id = $1
        AND u.status != 'SUSPENDED'
        AND EXISTS (
          SELECT 1 FROM user_groups ug
          JOIN groups g ON g.id = ug."groupId"
          WHERE ug."userId" = u.id AND g.name = 'LEARNER'
        )
        AND COALESCE(u."lastActiveAt", u."createdAt") < NOW() - ($2 || ' days')::interval
        AND NOT EXISTS (
          SELECT 1 FROM in_app_notifications n
          WHERE n."userId" = u.id
            AND n.type = $3
            AND n."createdAt" > NOW() - ($4 || ' days')::interval
        )
      `,
      [
        tenantId,
        INACTIVITY_DAYS_THRESHOLD,
        ENGAGEMENT_REMINDER_TYPE,
        REMINDER_COOLDOWN_DAYS,
      ],
    );
    return rows.map((row: { userId: number }) => ({
      userId: Number(row.userId),
    }));
  }

  /**
   * Always creates the in-app feed item — that's the source of truth for the
   * cooldown above and works even for a user with no registered device. Push
   * is best-effort on top: a send failure must never undo the feed item.
   */
  private async sendReminders(
    tenantId: string,
    learners: EligibleLearner[],
  ): Promise<number> {
    let sent = 0;

    for (const learner of learners) {
      try {
        await this.notificationService.create({
          userId: learner.userId,
          tenantId,
          type: ENGAGEMENT_REMINDER_TYPE,
          title: REMINDER_TITLE,
          body: REMINDER_BODY,
        });
        sent += 1;

        const tokens = await this.deviceTokenService.getTokensForUser(
          learner.userId,
        );
        if (tokens.length) {
          await this.pushService.sendDataMessage(tokens, {
            title: REMINDER_TITLE,
            body: REMINDER_BODY,
            type: ENGAGEMENT_REMINDER_TYPE,
          });
        }
      } catch (error) {
        EngagementReminderEvaluatorService.logger.error(
          `Failed reminder for user ${learner.userId}: ${error.message}`,
        );
      }
    }

    return sent;
  }
}
