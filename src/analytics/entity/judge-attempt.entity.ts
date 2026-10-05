import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import {
  JudgeAttemptFamily,
  JudgeAttemptOutcome,
} from '../constants/judge-scheduling.constants';

/**
 * One row per judge subject whose last scheduled attempt produced NO judgment
 * — the memory that stops the quality judges retrying it every thirty minutes
 * forever.
 *
 * The judges decide what to do next by asking "is there a judgment row?", and
 * a failure, a timeout or an empty answer writes none. So without this a
 * failing session looked exactly like a new one: the catch-ups re-picked it
 * every tick for a day and the newest-first drainer re-picked it at the head
 * of its queue every tick for up to 150 days, paying for the call each time.
 *
 * Shape and rules mirror foundational skills' FAILED rows: `attempts` counts
 * up on each failure, scheduled selectors skip a subject once it reaches
 * JUDGE_MAX_ATTEMPTS or while its last attempt is younger than
 * JUDGE_RETRY_AFTER_MINUTES, and a successful judgment DELETES the row. A
 * manual backfill ignores the cap, so recovering after a provider outage is
 * just re-running it.
 *
 * Platform-wide, like the judgment tables it gates: written by background
 * jobs that span tenants. `tenant_id` is the subject's own, kept so a test
 * org can be dropped at read time; nullable because recall rows can carry
 * none. Does NOT extend BaseEntity for that reason (its `tenant_id` is NOT
 * NULL) — the same divergence `llm_usage` documents.
 *
 * Never holds transcript text: `lastError` is a label built from the error's
 * shape (`describeJudgeFailure`), not its message.
 */
@Unique('UQ_judge_attempts_family_subject', ['family', 'subjectId'])
@Entity('judge_attempts')
export class JudgeAttempt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;

  /** drift | language | groundedness | recall-quality */
  @Column({ type: 'varchar', length: 32 })
  family!: JudgeAttemptFamily;

  /**
   * `scenario_sessions.id` for the session judges; `wm_recall_selections.id`
   * for recall-quality, which judges one turn at a time. No FK: the two
   * families point at different tables.
   */
  @Column({ type: 'uuid' })
  subjectId!: string;

  @Column({ type: 'smallint', default: 1 })
  attempts!: number;

  /** failed (the call threw or timed out) | empty (it answered with nothing) */
  @Column({ type: 'varchar', length: 16 })
  lastOutcome!: JudgeAttemptOutcome;

  /** e.g. `timeout (ECONNABORTED)`, `http 500`, `judge returned no claims`. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  lastError?: string | null;

  @Column({ type: 'timestamp', default: () => 'now()' })
  lastAttemptAt!: Date;
}
