import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { HelplineTenantScopedEntity } from './helpline-base';

/**
 * A listener's helpline-only settings. Absent until they first save one —
 * reads fall back to defaults (first name as alias, 2 concurrent chats).
 */
@Entity('helpline_listener_profiles')
export class HelplineListenerProfile extends HelplineTenantScopedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int', name: 'user_id', unique: true })
  userId!: number;

  /** The alias talkers see. Never the email or full name. */
  @Column({ type: 'varchar', length: 40, name: 'display_name' })
  displayName!: string;

  /** Capped at the org's `orgMaxConcurrentPerListener` when read. */
  @Column({ type: 'int', name: 'max_concurrent_chats', default: 2 })
  maxConcurrentChats!: number;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  languages!: string[];

  @Column({ type: 'boolean', name: 'notifications_enabled', default: true })
  notificationsEnabled!: boolean;
}
