import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { BuilderNotificationKind } from '../enum/builder.enum';

/**
 * A thing that happened while the admin was elsewhere.
 *
 * The point of a backgrounded agent is that you stop watching it, which makes
 * "it has been waiting on you for two hours" the failure mode to design
 * against. Every kind here marks a moment where the session stopped being
 * able to progress on its own, or finished.
 */
@Entity('builder_notifications')
@Index('idx_builder_notifications_admin_unread', ['adminId', 'readAt'])
export class BuilderNotification extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** users.id — int, no FK, per the platform convention for actor columns. */
  @Column({ type: 'int' })
  adminId!: number;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'varchar', length: 24, enum: BuilderNotificationKind })
  kind!: BuilderNotificationKind;

  /** One line, already written for a person — no client-side templating. */
  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'timestamp', nullable: true })
  readAt?: Date | null;
}
