import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One orchestration decision — the decision log (OPP-0776, shipped inside the
 * Finder stage, OPP-0781).
 *
 * Every choice Bug Hunter makes about HOW to work is recorded here with the
 * menu it chose from, the pick, who owned the pick (a rule or a model), what
 * the other owner would have picked, and the reason in one line. The shadow
 * pick is the point: it is what lets a decision point flip from rule to model
 * when the replay shows the model would have done better, and flip back when
 * it drifts.
 *
 * Points today: D1 (senses), D2 (model), D3 (triage) from the Finder. D4–D8
 * belong to the Verifier and the orchestrator and are logged as those stages
 * learn to.
 */
@Entity('bug_hunt_decisions')
@Index('idx_bug_hunt_decisions_run_id', ['runId'])
@Index('idx_bug_hunt_decisions_finding_id', ['findingId'])
@Index('idx_bug_hunt_decisions_point_created', ['point', 'createdAt'])
export class BugHuntDecision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'run_id', type: 'uuid', nullable: true })
  runId?: string | null;

  @Column({ name: 'finding_id', type: 'uuid', nullable: true })
  findingId?: string | null;

  @Column({ type: 'text', nullable: true })
  repo?: string | null;

  /** D1 … D8. */
  @Column({ type: 'varchar', length: 8 })
  point!: string;

  /** Who made the pick that was acted on. */
  @Column({ type: 'varchar', length: 8 })
  owner!: 'model' | 'rule';

  /** The closed set of options at this point, as offered. */
  @Column({ type: 'jsonb' })
  menu!: unknown;

  /** What was acted on. */
  @Column({ type: 'jsonb' })
  pick!: unknown;

  @Column({ name: 'shadow_owner', type: 'varchar', length: 8, nullable: true })
  shadowOwner?: 'model' | 'rule' | null;

  /** What the other owner would have picked, when it answered. */
  @Column({ name: 'shadow_pick', type: 'jsonb', nullable: true })
  shadowPick?: unknown;

  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  /** The context both owners saw: trigger, scoreboard rows, counts. Clipped. */
  @Column({ type: 'jsonb', nullable: true })
  inputs?: Record<string, unknown> | null;

  /** The deciding model, when a model answered at all. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  model?: string | null;

  /** Set later by the replay: did this pick lead to a better outcome than the shadow? */
  @Column({ type: 'varchar', length: 16, nullable: true })
  outcome?: 'better' | 'same' | 'worse' | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
