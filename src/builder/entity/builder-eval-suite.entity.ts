import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  BuilderEvalOverrides,
  BuilderEvalPromptCandidate,
  BuilderEvalSuiteStatus,
  BuilderEvalSuiteSummary,
  BuilderEvalSuiteTrigger,
  BuilderEvalVerdict,
} from '../eval/type/builder-eval.type';

/**
 * One eval suite: a set of fixtures, each run a few times, with whatever
 * candidate changes it was asked to try.
 *
 * A `prompt_gate` suite is also the record of a proposed Builder prompt
 * change: `candidate` is what goes live if `verdict.pass`, and `publishedAt`
 * says it did. Nothing else publishes a gated prompt.
 */
@Entity('builder_eval_suites')
@Index('idx_builder_eval_suites_created', ['createdAt'])
export class BuilderEvalSuite extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 20 })
  trigger!: BuilderEvalSuiteTrigger;

  @Column({ type: 'varchar', length: 20 })
  status!: BuilderEvalSuiteStatus;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  fixtureIds!: string[];

  @Column({ type: 'int' })
  repetitions!: number;

  @Column({ type: 'jsonb', nullable: true })
  overrides?: BuilderEvalOverrides | null;

  @Column({ type: 'jsonb', nullable: true })
  candidate?: BuilderEvalPromptCandidate | null;

  @Column({ type: 'jsonb', nullable: true })
  summary?: BuilderEvalSuiteSummary | null;

  @Column({ type: 'jsonb', nullable: true })
  verdict?: BuilderEvalVerdict | null;

  @Column({ type: 'timestamp', nullable: true })
  publishedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  error?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date | null;

  @Column({ type: 'int', nullable: true })
  createdBy?: number | null;

  /**
   * Times another process picked the suite up after the one running it went
   * away — a deploy replaces every task, and a suite is hours of runs.
   */
  @Column({ type: 'int', default: 0 })
  resumeCount!: number;
}
