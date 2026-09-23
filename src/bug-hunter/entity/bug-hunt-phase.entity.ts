import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { BugHuntPhase } from '../enum/bug-hunt-telemetry.enum';

/**
 * One phase of one run, with when it started and when it finished.
 *
 * `bug_hunt_events` already records WHAT a run did, step by step, but nothing
 * recorded how long each part took. When a sweep ran long the only figure
 * available was the whole job's wall-clock, and "was it the full suite, the
 * verifiers, or a fix that would not converge" could not be answered without
 * opening the CI log. The agent now POSTs a boundary as it enters and leaves
 * each phase (`POST runs/:id/phases`), and this row is the result.
 *
 * One row per (run, phase). A phase reported as started twice keeps its FIRST
 * start and counts the repeat in `metadata.startedCount`, because the fix
 * protocol legitimately re-enters FIX on a second attempt and the honest
 * duration of "fixing" is first entry to last exit.
 *
 * `durationMs` is stamped on finish rather than computed on read so the
 * percentile queries in `BugHuntPhaseRepository` stay one aggregate over one
 * column.
 *
 * Tokens are deliberately NOT here. The CLI reports usage once, at exit, for
 * the whole session, so per-phase tokens cannot be attributed honestly today;
 * that stays on the run (`totalInputTokens` / `totalOutputTokens`) until the
 * workflow streams usage per turn.
 *
 * The CHECK constraint on `phase` lives in the introducing migration only —
 * TypeORM cannot express it and `migration:generate` would propose dropping
 * it. Never generate migrations against this table.
 */
@Entity('bug_hunt_phases')
@Index('idx_bug_hunt_phases_run_id', ['runId'])
@Index('uq_bug_hunt_phases_run_phase', ['runId', 'phase'], { unique: true })
export class BugHuntPhaseTiming extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;

  @Column({ type: 'varchar', enum: BugHuntPhase })
  phase!: BugHuntPhase;

  @Column({ name: 'started_at', type: 'timestamp' })
  startedAt!: Date;

  /** Null while the phase is still open — or forever, for a run that died mid-phase. */
  @Column({ name: 'finished_at', type: 'timestamp', nullable: true })
  finishedAt?: Date | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs?: number | null;

  /** Optional one-liner from the agent on finish, e.g. "9 findings, 2 refuted". */
  @Column({ type: 'text', nullable: true })
  summary?: string | null;

  /** `startedCount`, plus anything the agent attaches. Never raw log or PII content. */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;
}
