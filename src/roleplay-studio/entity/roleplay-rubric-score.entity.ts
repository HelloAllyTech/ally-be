import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * Flattened per-behavior rubric scores from `director_rubric_score` SQS
 * messages: one row per (turn, behavior) so analytics can aggregate without
 * unpacking the jsonb payload on roleplay_director_events (which also keeps
 * the raw message). Append-only telemetry, no soft delete.
 */
@Entity('roleplay_rubric_scores')
@Index('idx_roleplay_rubric_scores_session_id', ['scenarioSessionId'])
@Index('idx_roleplay_rubric_scores_room_id', ['roomId'])
export class RoleplayRubricScore extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  @Column()
  roomId!: string;

  @Column({ type: 'int' })
  turnIndex!: number;

  // Rubric behavior id from the spec document (not the behaviors table).
  @Column()
  behaviorId!: string;

  @Column({ type: 'float' })
  score!: number;

  @Column({ type: 'text', nullable: true })
  rationale?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  occurredAt?: Date | null;
}
