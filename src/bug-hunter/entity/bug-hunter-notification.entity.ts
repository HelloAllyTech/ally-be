import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

import { BugHunterNotificationLevel } from '../enum/bug-hunter-notification.enum';

/**
 * One thing Bug Hunter wants to tell an admin, shown in the Bug Hunter tab's
 * own inbox.
 *
 * This replaces the Slack posts the module used to make (an escalation ping, a
 * run summary, a release outcome). Everything Bug Hunter has to say now lands
 * here and nowhere else, so there is one place to look and no second channel to
 * keep in sync.
 *
 * Deliberately NOT the platform `notifications` domain: those are addressed to
 * a specific end user and drive email/push. These are addressed to whoever is
 * looking after Bug Hunter — a role, not a person — and never leave the tab.
 * Modelling them as a small append-only log next to `bug_hunt_events` keeps
 * that boundary obvious.
 *
 * `bug_hunt_events` is the full transcript and stays that way: every step of
 * every run, whether or not a human should care. A notification is the much
 * smaller set worth interrupting someone for. An event does not imply a
 * notification.
 *
 * The CHECK constraint lives in migration 1900000000000 only — TypeORM cannot
 * express it and `migration:generate` would propose dropping it.
 */
@Entity('bug_hunter_notifications')
@Index('idx_bug_hunter_notifications_read_at', ['readAt'])
@Index('idx_bug_hunter_notifications_finding_id', ['findingId'])
export class BugHunterNotification extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The bug this is about, if any — the inbox row links straight into its drawer. */
  @Column({ name: 'finding_id', type: 'uuid', nullable: true })
  findingId?: string | null;

  @Column({ name: 'run_id', type: 'uuid', nullable: true })
  runId?: string | null;

  @Column({ type: 'text', nullable: true })
  repo?: string | null;

  @Column({ enum: BugHunterNotificationLevel })
  level!: BugHunterNotificationLevel;

  /** One scannable line — this is what the inbox list shows. */
  @Column({ type: 'text' })
  title!: string;

  /** The detail behind the title. Never raw log or PII content — same rule as `bug_hunt_events.payload`. */
  @Column({ type: 'text', nullable: true })
  body?: string | null;

  /**
   * Null while unread. Read is a per-notification act, not a per-admin one:
   * this tab has a handful of super-duper-admins working the same queue, and a
   * bug someone already dealt with should stop shouting at everyone.
   */
  @Column({ name: 'read_at', type: 'timestamp', nullable: true })
  readAt?: Date | null;

  /** Integer users.id with NO foreign key, per ally-be convention. */
  @Column({ name: 'read_by', type: 'int', nullable: true })
  readBy?: number | null;
}
