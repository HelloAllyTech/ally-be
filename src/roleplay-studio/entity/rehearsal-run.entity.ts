import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { RehearsalStatus } from '../enum/rehearsal-status.enum';

/**
 * One automated rehearsal of a spec version: ally-ai-learn plays SKILLED /
 * POOR / ADVERSARIAL simulated trainees against the actor+director and an LLM
 * judge scores the run. Lifecycle mirrors scenario_reports (redis TTL timer,
 * webhook updates, socket.io progress). At most one non-terminal run per spec
 * version at a time.
 */
@Entity('rehearsal_runs')
@Index('idx_rehearsal_runs_spec_id', ['specId'], {
  where: '"deletedAt" IS NULL',
})
@Index('idx_rehearsal_runs_spec_version_id', ['specVersionId'], {
  where: '"deletedAt" IS NULL',
})
export class RehearsalRun extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  specId!: string;

  @Column({ type: 'uuid' })
  specVersionId!: string;

  @Column({ enum: RehearsalStatus, default: RehearsalStatus.STARTED })
  status!: RehearsalStatus;

  // Snapshot of the run request: traineeProfiles, turnsPerProfile,
  // languageId, judgeModel.
  @Column({ type: 'jsonb' })
  config!: Record<string, any>;

  // { completed, total } as reported by the webhook.
  @Column({ type: 'jsonb', nullable: true })
  progress?: Record<string, any> | null;

  // { overall, dimensions: { persona_consistency, disclosure_discipline,
  //   difficulty_calibration, rubric_coverage }, per_profile } (0-100).
  @Column({ type: 'jsonb', nullable: true })
  results?: Record<string, any> | null;

  @Column({ type: 'text', nullable: true })
  reportMarkdown?: string | null;

  // errorMessage lives under metadata.errorMessage (scenario_reports pattern).
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;

  @Column({ type: 'timestamp', nullable: true })
  endedAt?: Date | null;

  @Column({ type: 'int' })
  createdBy!: number;

  @Column({ type: 'int' })
  updatedBy!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
