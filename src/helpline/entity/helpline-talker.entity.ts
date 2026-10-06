import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { HelplineChannel } from '../constants/helpline.constants';
import { HelplineTenantScopedEntity } from './helpline-base';

/**
 * An anonymous person who started a chat. No row exists before consent is
 * accepted. Identified only by the guest token, never by a user account.
 */
@Entity('helpline_talkers')
@Index('idx_helpline_talkers_tenant_ip_hash', ['tenantId', 'ipHash'])
export class HelplineTalker extends HelplineTenantScopedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 16, default: HelplineChannel.TEXT_WEB })
  channel!: HelplineChannel;

  /**
   * Encrypted at rest (`HelplineContentCipher`); ≤ 40 characters of plaintext,
   * enforced on write. Retention resets it to the plaintext 'Anonymous'.
   */
  @Column({ type: 'text', name: 'display_name' })
  displayName!: string;

  @Column({ type: 'varchar', length: 8 })
  language!: string;

  @Column({ type: 'varchar', length: 32, name: 'consent_version' })
  consentVersion!: string;

  @Column({ type: 'timestamptz', name: 'consent_accepted_at' })
  consentAcceptedAt!: Date;

  /** HMAC-SHA256 of the client ip with a server-side salt; abuse windows only. */
  @Column({ type: 'varchar', length: 64, name: 'ip_hash', nullable: true })
  ipHash!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'user_agent', nullable: true })
  userAgent!: string | null;

  @Column({ type: 'timestamptz', name: 'last_seen_at', nullable: true })
  lastSeenAt!: Date | null;

  /** Guest token revoked (erasure or block); every guest request re-checks it. */
  @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'blocked_at', nullable: true })
  blockedAt!: Date | null;

  @Column({ type: 'int', name: 'blocked_by', nullable: true })
  blockedBy!: number | null;

  @Column({ type: 'timestamptz', name: 'erased_at', nullable: true })
  erasedAt!: Date | null;

  /** Phase 5 (WhatsApp channel). */
  @Column({ type: 'uuid', name: 'wa_contact_id', nullable: true })
  waContactId!: string | null;
}
