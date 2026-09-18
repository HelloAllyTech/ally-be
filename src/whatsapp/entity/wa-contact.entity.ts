import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { WaConsentStatus, WaIdentitySource } from '../enum/whatsapp.enum';

/**
 * One phone number that has messaged the bot.
 *
 * The bot is open to anyone with the number, so this is still not a user record — there is no
 * account here and no password. It exists to hold consent state, the rate-limit and abuse handles,
 * and the thread a conversation belongs to.
 *
 * It now also holds a LINK to one, because the corpus is no longer global: a document can be
 * targeted at particular organisations, so answering a question means knowing which organisation
 * is asking. `userId`/`tenantId` are that link, resolved by matching the sender's number against
 * a user's stored phone. They are NULLABLE and expected to be null often — the number is the only
 * thing WhatsApp gives us, and plenty of people who message will not have it on their Ally
 * profile. An unlinked contact is answered with a "we can't recognise this number" reply rather
 * than from a guessed corpus.
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

  /**
   * The Ally user this number belongs to, when one was found. Null means unrecognised.
   *
   * Stored rather than resolved on the fly for every read: the admin conversation log shows which
   * worker (and organisation) a thread belongs to on every row, and the resolution query is a
   * scan over `users.phone`. Resolution still RE-RUNS on every inbound message, so a number added
   * to a profile after someone first messaged is picked up on their next question.
   */
  @Index('idx_wa_contacts_user')
  @Column({ type: 'int', name: 'user_id', nullable: true })
  userId?: number | null;

  /**
   * The organisation the corpus is scoped to for this contact.
   *
   * Denormalised from the user rather than joined at answer time so the audience is one field
   * read on the hot path. Kept in step by the same per-message resolution that sets `userId`, so
   * a worker moved between organisations is answered from their new one on their next question.
   *
   * `varchar`, not `uuid`, matching `users.tenant_id` — the platform spells this column both ways
   * and copying the source's type is what avoids a cast on every comparison.
   */
  @Index('idx_wa_contacts_tenant')
  @Column({ type: 'varchar', length: 64, name: 'tenant_id', nullable: true })
  tenantId?: string | null;

  @Column({ type: 'timestamp', name: 'identified_at', nullable: true })
  identifiedAt?: Date | null;

  /**
   * How the link was made. An ADMIN link is never overwritten by the automatic phone match: a
   * human who linked a contact by hand did so knowing the number does not match, and having the
   * next message quietly undo that would make the manual route useless.
   */
  @Column({
    type: 'varchar',
    length: 16,
    name: 'identity_source',
    nullable: true,
  })
  identitySource?: WaIdentitySource | null;

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
