import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * One simulated-trainee conversation from a rehearsal run (one row per
 * trainee profile, plus one per selected agent test case), delivered by the
 * rehearsal webhook. `transcript` is the ordered turn list [{ role, content,
 * turn_index, state_id?, stage_direction? }]; `directorTrace` is the
 * director's decision log for the run. Test-case rows carry
 * `traineeProfile='CONDITION_DRIVEN'` (a label, not an enum member),
 * `agentTestCaseId` (no FK — agent_test_cases is hard-deleted; the run
 * config holds the snapshot) and the evaluator's `testCaseResult`.
 */
@Entity('rehearsal_transcripts')
@Index('idx_rehearsal_transcripts_run_id', ['rehearsalRunId'], {
  where: '"deletedAt" IS NULL',
})
export class RehearsalTranscript extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  rehearsalRunId!: string;

  @Column()
  traineeProfile!: string;

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  transcript!: Record<string, any>[];

  @Column({ type: 'jsonb', nullable: true })
  judgeScores?: Record<string, any> | null;

  @Column({ type: 'text', nullable: true })
  judgeNotes?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  directorTrace?: Record<string, any> | null;

  // Set only on agent-test-case (CONDITION_DRIVEN) rows. Deliberately no FK:
  // the referenced case may be hard-deleted; run config keeps the snapshot.
  @Column({ type: 'uuid', nullable: true })
  agentTestCaseId?: string | null;

  // Evaluator verdict object for test-case rows:
  // { test_case_id, title, verdict, condition_recreated, evidence, reasoning }.
  @Column({ type: 'jsonb', nullable: true })
  testCaseResult?: Record<string, any> | null;

  @DeleteDateColumn()
  deletedAt?: Date;
}
