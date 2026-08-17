import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { CharacterInterviewSessionStatus } from '../enum/character-interview.enum';

/**
 * One character-library interview conversation. `lastMessageSeq` is the
 * monotonic message counter: appends increment it atomically
 * (UPDATE … RETURNING) so character_interview_messages.seq is gapless and
 * unique per session even under concurrent writers.
 *
 * `draftCharacter` is populated when the agent calls save_character_draft —
 * it is NOT a scenario_characters row: the human reviews the draft in the
 * character form and saving there creates the real library entry.
 */
@Entity('character_interview_sessions')
@Index('idx_character_interview_sessions_created_by', ['createdBy'], {
  where: '"deletedAt" IS NULL',
})
export class CharacterInterviewSession extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    enum: CharacterInterviewSessionStatus,
    default: CharacterInterviewSessionStatus.ACTIVE,
  })
  status!: CharacterInterviewSessionStatus;

  @Column({ type: 'int', default: 0 })
  lastMessageSeq!: number;

  // The generated character profile (ScenarioCharacterRequestDto shape).
  @Column({ type: 'jsonb', nullable: true })
  draftCharacter?: Record<string, any> | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  /**
   * Owning tenant, or NULL when a platform admin ran the interview. Carried
   * for cost attribution and for the per-tenant session caps in
   * CharacterInterviewSessionService — a session is still private to its
   * creator regardless.
   */
  @Index('idx_character_interview_sessions_tenant_id')
  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;

  @Column({ type: 'int' })
  createdBy!: number;

  @Column({ type: 'int' })
  updatedBy!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
