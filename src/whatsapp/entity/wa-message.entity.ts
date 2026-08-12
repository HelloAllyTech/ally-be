import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  WaHandledBy,
  WaMessageDirection,
  WaMessageStatus,
} from '../enum/whatsapp.enum';

/**
 * One inbound or outbound WhatsApp message.
 *
 * `providerMessageId` carries a UNIQUE index and that index is the bot's dedupe mechanism — not a
 * nicety. Two independent sources of duplicates exist: SQS is at-least-once, and Meta retries a
 * webhook it believes failed. An `INSERT ... ON CONFLICT DO NOTHING` against this index, executed as
 * the very first statement of the consumer, is what stops a worker being answered twice — the worst
 * failure mode this pipeline has.
 *
 * `body` holds a mental healthcare worker's clinical question, which is the most sensitive column in
 * this feature. It is why the ally-ai call redacts its request body from debug logs and why the
 * conversation-log permission is SUPER_DUPER_ADMIN only.
 */
@Entity('wa_messages')
@Index('idx_wa_messages_conversation', ['conversationId', 'createdAt'])
export class WaMessage extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'conversation_id' })
  conversationId!: string;

  @Index('idx_wa_messages_contact')
  @Column({ type: 'uuid', name: 'contact_id' })
  contactId!: string;

  @Column({ type: 'varchar', length: 16 })
  direction!: WaMessageDirection;

  /**
   * The provider's own message id. UNIQUE — see the class comment; this is the dedupe key.
   *
   * Nullable because an outbound send that failed before the provider accepted it has no id, and
   * Postgres unique indexes permit multiple NULLs.
   */
  @Index('uq_wa_messages_provider_id', { unique: true })
  @Column({
    type: 'varchar',
    length: 128,
    name: 'provider_message_id',
    nullable: true,
  })
  providerMessageId?: string | null;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'varchar', length: 16, nullable: true })
  language?: string | null;

  @Index('idx_wa_messages_handled_by')
  @Column({ type: 'varchar', length: 24, name: 'handled_by', nullable: true })
  handledBy?: WaHandledBy | null;

  @Column({ type: 'uuid', name: 'template_id', nullable: true })
  templateId?: string | null;

  /**
   * Resolved citations as returned by the agent: chunk id, document, page, section, similarity.
   * Stored so the admin log can resolve each one back to the exact passage that was quoted, months
   * later, even if the document has since been re-chunked into new ids.
   */
  @Column({ type: 'jsonb', nullable: true })
  citations?: Record<string, any>[] | null;

  /**
   * What retrieval did, plus the provider and model that ACTUALLY ran.
   *
   * The model matters because it is admin-selectable and dispatch falls back when a key is missing,
   * so "why did this answer change?" is otherwise unanswerable — prompt_version alone does not move
   * when someone swaps Claude for Gemini in the UI.
   */
  @Column({ type: 'jsonb', name: 'retrieval_meta', nullable: true })
  retrievalMeta?: Record<string, any> | null;

  @Column({ type: 'int', name: 'latency_ms', nullable: true })
  latencyMs?: number | null;

  @Column({
    type: 'varchar',
    length: 16,
    default: WaMessageStatus.RECEIVED,
  })
  status!: WaMessageStatus;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage?: string | null;

  /** For an outbound message, the inbound message it answers. */
  @Column({ type: 'uuid', name: 'in_reply_to_id', nullable: true })
  inReplyToId?: string | null;
}
