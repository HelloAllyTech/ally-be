import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * An automated (LLM-as-judge) evaluation of a single AI Lab run's output. An
 * admin supplies a rubric ("criteria") and a judge model scores the run's
 * output 0–100 with a short rationale. Complements human evaluation — cheap,
 * fast, repeatable. Multiple auto-evaluations per run are allowed (e.g.
 * different rubrics or judge models).
 */
@Entity('lab_auto_evaluations')
export class LabAutoEvaluation extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_lab_auto_eval_run_id')
  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;

  /** Judge model id (from the LLM registry). */
  @Column({ type: 'varchar', length: 100 })
  model!: string;

  /** The rubric / instructions the judge scored against. */
  @Column({ type: 'text' })
  criteria!: string;

  /** 0–100 score (null if the judge output couldn't be parsed). */
  @Column({ type: 'int', nullable: true })
  score?: number | null;

  /** The judge's short rationale. */
  @Column({ type: 'text', nullable: true })
  reasoning?: string | null;

  /** Set when the evaluation itself failed (provider/parse error). */
  @Column({ type: 'text', nullable: true })
  error?: string | null;

  @Column({ name: 'created_by', type: 'int' })
  createdBy!: number;
}
