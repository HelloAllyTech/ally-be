import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { BuilderEventType, BuilderStage } from '../enum/builder.enum';

/**
 * Append-only build log — one row per thing the agent said or did.
 *
 * Modeled on `bug_hunt_events`, with one difference that matters: this log is
 * read as a live transcript rather than a post-hoc timeline, so it carries
 * engine-level granularity (every tool call, every file edit) as well as
 * milestones. That volume is why payloads are truncated on ingestion and why
 * readers page with `afterSeq` instead of refetching the run.
 *
 * `sessionId` is denormalised so the session-wide feed does not join through
 * runs on every read — a session with five resume runs is one conversation to
 * the person watching it.
 */
@Entity('builder_build_events')
@Index('idx_builder_build_events_run_seq', ['runId', 'seq'], { unique: true })
@Index('idx_builder_build_events_session', ['sessionId', 'createdAt'])
export class BuilderBuildEvent extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  runId!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'int' })
  seq!: number;

  /** The stage in force when this landed, for filtering the feed by phase. */
  @Column({ type: 'varchar', length: 16, enum: BuilderStage, nullable: true })
  stage?: BuilderStage | null;

  @Column({ type: 'varchar', length: 20, enum: BuilderEventType })
  type!: BuilderEventType;

  @Column({ type: 'jsonb' })
  payload!: Record<string, any>;
}
