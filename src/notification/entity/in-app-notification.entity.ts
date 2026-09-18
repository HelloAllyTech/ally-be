import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';

/**
 * Generic in-app notification feed row — the bell in the nav sidebar (web)
 * and the Notifications screen (mobile). `type` distinguishes the source
 * ('ENGAGEMENT_REMINDER' today; a generic feed rather than a bespoke table so
 * a future notification source doesn't need its own schema+screen).
 *
 * Doubles as the engagement-reminder evaluator's own dedup/cooldown record —
 * "has this user already been sent a reminder in the last N days" is a
 * `NOT EXISTS` against this table, so there is no separate deliveries table.
 */
@Entity('in_app_notifications')
@Index('idx_in_app_notifications_user_type_created', [
  'userId',
  'type',
  'createdAt',
])
export class InAppNotification extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'integer' })
  userId!: number;

  @Column({ type: 'varchar', length: 50 })
  type!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  /** No PII/PHI — deep-link hints only (e.g. `{ screen: 'Simulations' }`). */
  @Column({ type: 'jsonb', nullable: true })
  data?: Record<string, unknown> | null;

  @Column({ type: 'timestamp', nullable: true })
  readAt?: Date | null;
}
