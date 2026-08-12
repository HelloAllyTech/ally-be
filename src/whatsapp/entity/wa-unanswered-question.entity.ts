import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { WaUnansweredReason, WaUnansweredStatus } from '../enum/whatsapp.enum';

/**
 * A question the corpus could not answer, as an admin worklist item.
 *
 * Its own table rather than a query over `wa_messages` for two reasons. It carries workflow state
 * (assignee, note, the document it became) that does not belong on a message. And it must outlive
 * message-body retention: the whole value of this queue is the list of things the corpus is missing,
 * and that list should survive a purge of the conversations that revealed them.
 *
 * A CLARIFY outcome deliberately does NOT land here. A question too vague to retrieve against is not
 * evidence of a corpus gap, and letting those in would bury the real gaps under noise.
 */
@Entity('wa_unanswered_questions')
export class WaUnansweredQuestion extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** UNIQUE: one row per message, so a redelivery cannot double-file the same gap. */
  @Index('uq_wa_unanswered_message', { unique: true })
  @Column({ type: 'uuid', name: 'message_id' })
  messageId!: string;

  @Column({ type: 'uuid', name: 'conversation_id' })
  conversationId!: string;

  @Column({ type: 'text', name: 'question_text' })
  questionText!: string;

  @Column({ type: 'varchar', length: 16, nullable: true })
  language?: string | null;

  @Index('idx_wa_unanswered_reason')
  @Column({ type: 'varchar', length: 24 })
  reason!: WaUnansweredReason;

  /** The best similarity retrieval managed. Shows how close the corpus came. */
  @Column({
    type: 'numeric',
    precision: 6,
    scale: 4,
    name: 'top_similarity',
    nullable: true,
  })
  topSimilarity?: string | null;

  @Column({ type: 'int', name: 'hit_count', default: 0 })
  hitCount!: number;

  @Index('idx_wa_unanswered_status')
  @Column({
    type: 'varchar',
    length: 16,
    default: WaUnansweredStatus.OPEN,
  })
  status!: WaUnansweredStatus;

  @Column({ type: 'int', name: 'assigned_to', nullable: true })
  assignedTo?: number | null;

  @Column({ type: 'text', name: 'resolution_note', nullable: true })
  resolutionNote?: string | null;

  /** Set when this gap was turned into a corpus document — closes the loop. */
  @Column({ type: 'uuid', name: 'linked_document_id', nullable: true })
  linkedDocumentId?: string | null;

  @Column({ type: 'int', name: 'resolved_by', nullable: true })
  resolvedBy?: number | null;

  @Column({ type: 'timestamp', name: 'resolved_at', nullable: true })
  resolvedAt?: Date | null;
}
