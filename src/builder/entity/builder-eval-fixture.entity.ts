import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  BuilderEvalFixtureKind,
  BuilderEvalPayload,
} from '../eval/type/builder-eval.type';

/**
 * A recorded Builder interview (or one PRD) the replay eval can play again.
 *
 * In the database rather than the repo because it carries what a production
 * admin typed, and ally-be is public. Created from a session ("save as eval
 * fixture") or imported from another environment's export; the checklist is
 * written by a person once and is what makes the fixture worth running.
 */
@Entity('builder_eval_fixtures')
export class BuilderEvalFixture extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_builder_eval_fixtures_name', { unique: true })
  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 20 })
  kind!: BuilderEvalFixtureKind;

  /** The session it was cut from. No FK: a fixture outlives its session. */
  @Column({ type: 'uuid', nullable: true })
  sourceSessionId?: string | null;

  @Column({ type: 'jsonb' })
  payload!: BuilderEvalPayload;

  /** Why it is in the golden set — the failure it reproduces, or "clean control". */
  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  /** Inactive fixtures are kept but left out of a suite that names none. */
  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'int', nullable: true })
  createdBy?: number | null;
}
