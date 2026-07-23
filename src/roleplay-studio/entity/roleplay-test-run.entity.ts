import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { RoleplayTestRunStatus } from '../enum/roleplay-test-run.enum';

/**
 * One trainer-initiated Improve test run of a spec version: ally-ai-learn
 * plays an LLM trainee primed with each selected agent test case against the
 * actor+director and an LLM judge scores every session. Lifecycle mirrors
 * scenario_reports (redis TTL timer, webhook updates with one-way end
 * statuses). At most one non-terminal run per spec at a time.
 */
@Entity('roleplay_test_runs')
@Index('idx_roleplay_test_runs_spec_id', ['specId'], {
  where: '"deletedAt" IS NULL',
})
@Index('idx_roleplay_test_runs_spec_version_id', ['specVersionId'], {
  where: '"deletedAt" IS NULL',
})
@Index('idx_roleplay_test_runs_source_report_id', ['sourceReportId'], {
  where: '"deletedAt" IS NULL',
})
export class RoleplayTestRun extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  specId!: string;

  @Column({ type: 'uuid' })
  specVersionId!: string;

  @Column({
    enum: RoleplayTestRunStatus,
    default: RoleplayTestRunStatus.STARTED,
  })
  status!: RoleplayTestRunStatus;

  // Snapshot of the run request: testCases (agent-test-case snapshots
  // {id,title,type,tags,description,condition,test,rubrics} — the source rows
  // are hard-deleted, so runs stay self-describing), turnsPerCase, languageId,
  // judgeModel, traineeModel, timeoutMinutes (watchdog, scales with the unit
  // count).
  @Column({ type: 'jsonb' })
  config!: Record<string, any>;

  // { completed, total } as reported by the webhook.
  @Column({ type: 'jsonb', nullable: true })
  progress?: Record<string, any> | null;

  // Aggregate wire results ({ overall, dimensions, test_counts,
  // test_pass_rate, … }) — per-case detail lives on the report rows.
  @Column({ type: 'jsonb', nullable: true })
  resultsSummary?: Record<string, any> | null;

  @Column({ type: 'text', nullable: true })
  reportMarkdown?: string | null;

  // errorMessage lives under metadata.errorMessage (scenario_reports pattern).
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;

  @Column({ type: 'timestamp', nullable: true })
  endedAt?: Date | null;

  /**
   * Set when this run is the automatic re-run of an auto-improved report —
   * points at the PARENT roleplay_test_reports row whose improveStatus this
   * run finalizes.
   */
  @Column({ type: 'uuid', nullable: true })
  sourceReportId?: string | null;

  @Column({ type: 'int' })
  createdBy!: number;

  @Column({ type: 'int' })
  updatedBy!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
