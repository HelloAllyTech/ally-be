import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SkillExperimentEventType } from '../enum/skill-experiment.enum';

/**
 * Append-only timeline of an experiment — every decision the loop or an admin
 * made, in words. This is how an admin returning to a paused skill reads what
 * happened while they were away. `actorId` is null for the loop itself.
 *
 * `metadata` carries numbers (scores, sample counts), never skill input or
 * output.
 */
@Entity('skill_experiment_events')
@Index('IDX_skill_experiment_events_experiment_created', [
  'experimentId',
  'createdAt',
])
export class SkillExperimentEvent extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  experimentId!: string;

  @Column({ type: 'uuid', nullable: true })
  variantId?: string | null;

  @Column({ type: 'varchar', length: 32 })
  type!: SkillExperimentEventType;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;

  @Column({ type: 'int', nullable: true })
  actorId?: number | null;
}
