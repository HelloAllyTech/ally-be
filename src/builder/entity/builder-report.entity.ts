import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { BuilderReportType } from '../enum/builder.enum';

/**
 * What the agent says about its own work.
 *
 * Distinct from the event log on purpose: the log is what happened, in order,
 * at engine granularity; a report is the agent's account of it — what it
 * built, what it decided, where it departed from the PRD and why. Reading
 * four hundred events to answer "what did this actually change?" is not a
 * reasonable ask of a reviewer, and the PR body is generated from this.
 */
@Entity('builder_reports')
@Index('idx_builder_reports_session', ['sessionId', 'type'])
export class BuilderReport extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  /** Null for a session-level rollup that spans every run. */
  @Column({ type: 'uuid', nullable: true })
  runId?: string | null;

  @Column({ type: 'varchar', length: 20, enum: BuilderReportType })
  type!: BuilderReportType;

  @Column({ type: 'text' })
  contentMd!: string;

  /** Files changed, tests added/run, stage durations, tokens, cost, minutes. */
  @Column({ type: 'jsonb', nullable: true })
  metrics?: Record<string, any> | null;
}
