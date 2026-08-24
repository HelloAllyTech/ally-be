import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { SESService } from 'src/aws/service/ses.service';
import { AppConfigService } from 'src/config/config.service';
import dayjs, {
  BUSINESS_TIMEZONE,
  toBusinessDateString,
} from 'src/common/util/date.util';

/**
 * Hour of the business day the reminder goes out. 20:00 leaves several hours
 * before the streak actually resets at business-timezone midnight, so a nudge
 * is still actionable, while being late enough that most of the day's practice
 * has already happened.
 */
export const REMINDER_HOUR = 20;

/**
 * Shortest streak worth an email. A one-day "streak" is not yet a loss the user
 * would feel, and emailing about it is the fastest way to train people to
 * ignore these.
 */
export const MIN_STREAK_TO_REMIND = 2;

/** Recipients per SES batch, and how many batches run concurrently. */
const SEND_CHUNK_SIZE = 10;

interface ReminderRecipient {
  userId: number;
  email: string;
  name: string;
  currentStreak: number;
}

@Injectable()
export class StreakReminderService {
  private static readonly logger = LoggerService.getInstance(
    StreakReminderService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
    private readonly sesService: SESService,
    private readonly configService: AppConfigService,
  ) {}

  /**
   * Entry point for the hourly scheduled task.
   *
   * Registered on the hourly tick rather than a dedicated cron because the
   * @Cron decorators in ScheduledTaskRunnerService carry no timeZone option, so
   * they fire on the *container's* local hour — which nothing in this repo
   * sets. Gating here on the business-timezone hour makes the behaviour
   * independent of that: dayjs().tz() converts from the absolute instant, so
   * only the tick that lands inside the 20:00 business hour proceeds.
   */
  async sendAtRiskReminders(): Promise<void> {
    const nowBusiness = dayjs().tz(BUSINESS_TIMEZONE);
    if (nowBusiness.hour() !== REMINDER_HOUR) {
      return;
    }

    const businessToday = toBusinessDateString();

    // The runner's advisory lock only prevents two replicas racing within one
    // tick. With a container timezone offset by :30, two ticks can land inside
    // the same business hour — this makes the send once-per-day regardless.
    const lockAcquired = await this.redisService.acquireLock(
      `streak-reminder:${businessToday}`,
      6 * 60 * 60,
    );
    if (!lockAcquired) {
      return;
    }

    const tenantIds = await this.getOptedInTenantIds();
    if (!tenantIds.length) {
      return;
    }

    for (const tenantId of tenantIds) {
      try {
        const recipients = await this.getAtRiskRecipients(
          tenantId,
          businessToday,
        );
        if (!recipients.length) {
          continue;
        }
        const sent = await this.sendToRecipients(recipients);
        StreakReminderService.logger.info(
          `Streak reminders for tenant ${tenantId}: ${sent}/${recipients.length} sent`,
        );
      } catch (error) {
        StreakReminderService.logger.error(
          `Failed sending streak reminders for tenant ${tenantId}: ${error.message}`,
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
        AND COALESCE(settings->'practiceStreak'->>'remindersEnabled', 'false') = 'true'
      `,
    );
    return rows.map((row: { id: string }) => row.id);
  }

  /**
   * Learners whose streak is alive as of yesterday but not yet secured today.
   *
   * "Already practised" is excluded by construction rather than filtered
   * afterwards, so a user who practises between the query and the send is the
   * only race left — and that one only costs a redundant email, never a wrong
   * one. The grace boundary (>= today - 1) is what makes this an *at-risk* list
   * rather than an *already-broken* one.
   */
  private async getAtRiskRecipients(
    tenantId: string,
    businessToday: string,
  ): Promise<ReminderRecipient[]> {
    const rows = await this.dataSource.query(
      `
      WITH candidates AS (
        SELECT u.id AS "userId", u.email, u.name
        FROM users u
        WHERE u.tenant_id = $1
          AND u.status != 'SUSPENDED'
          AND u.email IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM user_groups ug
            JOIN groups g ON g.id = ug."groupId"
            WHERE ug."userId" = u.id AND g.name = 'LEARNER'
          )
          AND NOT EXISTS (
            SELECT 1 FROM user_daily_scores uds
            WHERE uds."userId" = u.id
              AND uds.tenant_id = $1
              AND uds."date" = $2::date
              AND uds."minutesPlayed" >= 1.00
          )
          AND NOT EXISTS (
            SELECT 1 FROM user_preferences up
            WHERE up."userId" = u.id
              AND up.data->>'streak_reminder_enabled' = 'false'
          )
      ),
      active_days AS (
        SELECT DISTINCT uds."userId", uds."date"::date AS active_day
        FROM user_daily_scores uds
        JOIN candidates c ON c."userId" = uds."userId"
        WHERE uds.tenant_id = $1
          AND uds."minutesPlayed" >= 1.00
      ),
      islands AS (
        SELECT
          "userId",
          active_day,
          active_day - (ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY active_day))::int AS island
        FROM active_days
      ),
      runs AS (
        SELECT "userId", COUNT(*)::int AS run_length, MAX(active_day) AS last_day
        FROM islands
        GROUP BY "userId", island
      )
      SELECT
        c."userId",
        c.email,
        c.name,
        MAX(r.run_length) FILTER (WHERE r.last_day >= $2::date - 1) AS "currentStreak"
      FROM candidates c
      JOIN runs r ON r."userId" = c."userId"
      GROUP BY c."userId", c.email, c.name
      HAVING MAX(r.run_length) FILTER (WHERE r.last_day >= $2::date - 1) >= $3
      ORDER BY c."userId"
      `,
      [tenantId, businessToday, MIN_STREAK_TO_REMIND],
    );

    return rows.map((row: any) => ({
      userId: Number(row.userId),
      email: row.email,
      name: row.name,
      currentStreak: parseInt(row.currentStreak) || 0,
    }));
  }

  /** SES is one call per recipient, so send in bounded chunks. */
  private async sendToRecipients(
    recipients: ReminderRecipient[],
  ): Promise<number> {
    let sent = 0;

    for (let i = 0; i < recipients.length; i += SEND_CHUNK_SIZE) {
      const chunk = recipients.slice(i, i + SEND_CHUNK_SIZE);
      const results = await Promise.all(
        chunk.map((recipient) =>
          this.sesService
            .sendEmail({
              from: this.configService.email?.sourceEmail,
              to: recipient.email,
              subject: `Your ${recipient.currentStreak}-day practice streak ends tonight`,
              body: this.buildBody(recipient),
              isHtml: false,
              purpose: 'streak reminder',
              // The ONLY caller that opts out of the per-send Slack alert. A
              // reminder run can be hundreds of recipients, and an SES outage
              // would post one alert per recipient — burying the signal the
              // alert exists to raise. The aggregate `sent` count this method
              // returns is what surfaces the outage here instead.
              alertOnFailure: false,
            })
            .catch(() => false),
        ),
      );
      sent += results.filter(Boolean).length;
    }

    return sent;
  }

  private buildBody(recipient: ReminderRecipient): string {
    // Quotes the real rule (one minute), the same number every other streak
    // surface shows. If this said "15 minutes" while the app said one, the
    // reminder would be the thing users learn to distrust.
    return [
      `Hi ${recipient.name},`,
      '',
      `You're on a ${recipient.currentStreak}-day practice streak. You haven't practised today yet, so it ends at midnight.`,
      '',
      'One role play of a minute or more keeps it going.',
      '',
      'You can turn these reminders off in your Ally settings.',
    ].join('\n');
  }
}
