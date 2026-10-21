import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { BuilderPrdDocument } from '../type/builder-prd.type';
import {
  BuilderEvalCriticOutcome,
  BuilderEvalGates,
  BuilderEvalJudgement,
  BuilderEvalMetrics,
  BuilderEvalRunStatus,
  BuilderEvalTurnRecord,
} from '../eval/type/builder-eval.type';

/** One fixture played once, inside a suite. */
@Entity('builder_eval_runs')
@Index('idx_builder_eval_runs_suite', ['suiteId'])
@Index('idx_builder_eval_runs_fixture', ['fixtureId', 'createdAt'])
export class BuilderEvalRun extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  suiteId!: string;

  @Column({ type: 'uuid' })
  fixtureId!: string;

  /** 1-based: the same fixture is run several times because the model is not deterministic. */
  @Column({ type: 'int' })
  repetition!: number;

  @Column({ type: 'varchar', length: 20 })
  status!: BuilderEvalRunStatus;

  @Column({ type: 'jsonb', nullable: true })
  gates?: BuilderEvalGates | null;

  @Column({ type: 'jsonb', nullable: true })
  metrics?: BuilderEvalMetrics | null;

  @Column({ type: 'jsonb', nullable: true })
  judge?: BuilderEvalJudgement | null;

  @Column({ type: 'jsonb', nullable: true })
  critic?: BuilderEvalCriticOutcome | null;

  /** The replay, turn by turn — what to read when a run fails. */
  @Column({ type: 'jsonb', nullable: true })
  transcript?: BuilderEvalTurnRecord[] | null;

  @Column({ type: 'jsonb', nullable: true })
  finalPrd?: BuilderPrdDocument | null;

  @Column({ type: 'text', nullable: true })
  error?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date | null;
}
