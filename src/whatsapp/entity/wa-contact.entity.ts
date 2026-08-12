import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { WaConsentStatus } from '../enum/whatsapp.enum';

/**
 * One phone number that has messaged the bot.
 *
 * The bot is open to anyone with the number, so this is not a user record — there is no account, no
 * password and no tenant. It exists to hold consent state, the rate-limit and abuse handles, and
 * the thread a conversation belongs to.
 *
 * `phoneE164` is the plaintext number, stored deliberately (an explicit decision, not a default):
 * it is what lets an admin follow up on a crisis message or block a specific abuser. That makes
 * this identifiable data about mental healthcare workers, so it is masked to the last four digits
 * everywhere in the admin UI with an explicit reveal, and `phoneLast4` exists so a list view never
 * needs to load the full number at all.
 */
@Entity('wa_contacts')
export class WaContact extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('uq_wa_contacts_phone', { unique: true })
  @Column({ type: 'varchar', length: 32, name: 'phone_e164' })
  phoneE164!: string;

  /** Derived on write, so a masked list view never selects the full number. */
  @Column({ type: 'varchar', length: 4, name: 'phone_last4' })
  phoneLast4!: string;

  @Column({
    type: 'varchar',
    length: 16,
    name: 'consent_status',
    default: WaConsentStatus.PENDING,
  })
  consentStatus!: WaConsentStatus;

  @Column({ type: 'timestamp', name: 'consent_granted_at', nullable: true })
  consentGrantedAt?: Date | null;

  @Column({ type: 'timestamp', name: 'opted_out_at', nullable: true })
  optedOutAt?: Date | null;

  @Column({ type: 'timestamp', name: 'first_seen_at' })
  firstSeenAt!: Date;

  @Column({ type: 'timestamp', name: 'last_seen_at' })
  lastSeenAt!: Date;

  @Column({ type: 'int', name: 'message_count', default: 0 })
  messageCount!: number;

  /** Last detected language, so a reply can default to it when detection is ambiguous. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  locale?: string | null;

  /**
   * Blocked numbers are dropped silently rather than told they are blocked. Telling an abuser
   * exactly when they have been blocked mostly teaches them to switch numbers.
   */
  @Column({ type: 'timestamp', name: 'blocked_at', nullable: true })
  blockedAt?: Date | null;

  @Column({ type: 'text', name: 'blocked_reason', nullable: true })
  blockedReason?: string | null;
}
