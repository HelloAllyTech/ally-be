import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  RoleplayReportImproveStatus,
  RoleplayTestReportStatus,
} from '../enum/roleplay-test-run.enum';
import { RoleplayTestCaseSnapshot } from '../type/roleplay-test-run-request.type';

/**
 * One agent-test-case execution inside a test run: created PENDING with the
 * run, filled by ai-learn's per-unit webhook delivery (transcript + judge
 * verdict/scores + per-report markdown). `specId` is denormalized so the
 * Improve drawer can list a spec's reports across runs in one query.
 * Auto-improve lineage: `improveOfReportId` points a child (re-run) report at
 * its parent; `improveStatus`/`improveMeta` live on the PARENT while its
 * evidence is fed through the copilot.
 */
@Entity('roleplay_test_reports')
@Index('idx_roleplay_test_reports_run_id', ['runId'], {
  where: '"deletedAt" IS NULL',
})
@Index('idx_roleplay_test_reports_spec_id', ['specId'], {
  where: '"deletedAt" IS NULL',
})
@Index(
  'idx_roleplay_test_reports_improve_of_report_id',
  ['improveOfReportId'],
  {
    where: '"deletedAt" IS NULL',
  },
)
@Index('uq_roleplay_test_reports_run_case', ['runId', 'agentTestCaseId'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class RoleplayTestReport extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  runId!: string;

  @Column({ type: 'uuid' })
  specId!: string;

  @Column({ type: 'uuid' })
  specVersionId!: string;

  // Deliberately no FK: agent_test_cases is global + hard-deleted;
  // testCaseSnapshot keeps the run self-describing.
  @Column({ type: 'uuid' })
  agentTestCaseId!: string;

  // Full case snapshot {id,title,type,tags,description,condition,test,rubrics}
  // taken at run creation (or replayed from the parent report on re-runs).
  @Column({ type: 'jsonb' })
  testCaseSnapshot!: RoleplayTestCaseSnapshot;

  @Column({
    enum: RoleplayTestReportStatus,
    default: RoleplayTestReportStatus.PENDING,
  })
  status!: RoleplayTestReportStatus;

  // Ordered turn list [{ role, content, turn_index, state_id?,
  // stage_direction? }] from the simulated session.
  @Column({ type: 'jsonb', nullable: true })
  transcript?: Record<string, any>[] | null;

  @Column({ type: 'jsonb', nullable: true })
  directorTrace?: Record<string, any> | null;

  // The judge's four session-quality dimensions (0-100).
  @Column({ type: 'jsonb', nullable: true })
  judgeScores?: Record<string, any> | null;

  @Column({ type: 'text', nullable: true })
  judgeNotes?: string | null;

  // Raw wire TestCaseResult object (verdict/rubric_scores/evidence/…).
  @Column({ type: 'jsonb', nullable: true })
  testResult?: Record<string, any> | null;

  // Extracted for cheap list queries: condition cases only
  // (PASSED|FAILED|INCONCLUSIVE).
  @Column({ type: 'varchar', nullable: true })
  verdict?: string | null;

  // Extracted for cheap list queries: full_session cases only (0-100).
  @Column({ type: 'int', nullable: true })
  overallScore?: number | null;

  // Per-report markdown (ai-learn's unit_report_markdown).
  @Column({ type: 'text', nullable: true })
  reportMarkdown?: string | null;

  /** Lineage: set on re-run reports, pointing at the improved parent report. */
  @Column({ type: 'uuid', nullable: true })
  improveOfReportId?: string | null;

  /** Auto-improve lifecycle — set on the PARENT report being improved. */
  @Column({ type: 'varchar', nullable: true })
  improveStatus?: RoleplayReportImproveStatus | null;

  // { copilotSessionId, assistantMessageSeq, newSpecVersionId, error }.
  @Column({ type: 'jsonb', nullable: true })
  improveMeta?: Record<string, any> | null;

  @Column({ type: 'timestamp', nullable: true })
  endedAt?: Date | null;

  @Column({ type: 'int' })
  createdBy!: number;

  @Column({ type: 'int' })
  updatedBy!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
