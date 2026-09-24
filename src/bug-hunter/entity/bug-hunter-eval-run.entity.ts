import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { BugHunterEvalPromptKind } from '../enum/bug-hunter-eval.enum';

/**
 * One replay of a Bug Hunter prompt over the labelled eval set, with how it
 * scored — see `scripts/bug-hunter/eval-verifier.mjs`, which produces these.
 *
 * Until this table existed, the only test of a prompt edit was a unit test on
 * the string, and whether a change helped was learned by watching production
 * for a week. A row here is the number a change carries before it ships: the
 * verifier prompt at `promptHash`, run on `model`, agreed with the settled
 * human outcome `agreement` of the time over `itemCount` findings.
 *
 * `promptHash` is a sha256 of the prompt text as run, so two rows with the
 * same hash and model are the same experiment and their difference is noise;
 * that is what makes the number comparable across weeks. The prompt-version
 * registry (a later roadmap item) will stamp the same hash on production runs,
 * which is what will let a replay score sit beside the live precision of the
 * same prompt.
 *
 * `perSource` and `calibration` are small JSON summaries, not raw verdicts:
 * agreement by finding source, and verdict certainty bucketed against the
 * label, so the confidence threshold can be read off rather than guessed.
 */
@Entity('bug_hunter_eval_runs')
@Index('idx_bug_hunter_eval_runs_created_at', ['createdAt'])
@Index('idx_bug_hunter_eval_runs_prompt_hash', ['promptHash'])
export class BugHunterEvalRun extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Null when the set spanned every repo. */
  @Column({ type: 'text', nullable: true })
  repo?: string | null;

  @Column({
    name: 'prompt_kind',
    type: 'varchar',
    enum: BugHunterEvalPromptKind,
  })
  promptKind!: BugHunterEvalPromptKind;

  @Column({ name: 'prompt_hash', type: 'varchar', length: 64 })
  promptHash!: string;

  @Column({ type: 'varchar' })
  model!: string;

  /** Sha256 of the eval-set file replayed, so like is compared with like. */
  @Column({ name: 'set_hash', type: 'varchar', length: 64, nullable: true })
  setHash?: string | null;

  @Column({ name: 'item_count', type: 'int' })
  itemCount!: number;

  /** Items the model answered with parseable JSON. The score divides by this. */
  @Column({ name: 'answered_count', type: 'int' })
  answeredCount!: number;

  /** Share of answered items whose verdict matched the label, 0-1. */
  @Column({ type: 'numeric', precision: 5, scale: 4, nullable: true })
  agreement?: string | null;

  /** Share of REAL items the verifier accepted — how many real bugs it would have kept. */
  @Column({
    name: 'real_recall',
    type: 'numeric',
    precision: 5,
    scale: 4,
    nullable: true,
  })
  realRecall?: string | null;

  /** Share of NOT_A_BUG items the verifier refuted — how many false positives it would have caught. */
  @Column({
    name: 'not_a_bug_recall',
    type: 'numeric',
    precision: 5,
    scale: 4,
    nullable: true,
  })
  notABugRecall?: string | null;

  /** `{ [source]: { items, agreed } }`. */
  @Column({ name: 'per_source', type: 'jsonb', nullable: true })
  perSource?: Record<string, { items: number; agreed: number }> | null;

  /** `{ [labelSource]: { items, agreed } }` — strong tiers apart from the weak one. */
  @Column({ name: 'per_label_source', type: 'jsonb', nullable: true })
  perLabelSource?: Record<string, { items: number; agreed: number }> | null;

  /** `[{ bucket: "0.7-0.8", items, agreed }]` over the verifier's self-reported certainty. */
  @Column({ type: 'jsonb', nullable: true })
  calibration?: Array<{ bucket: string; items: number; agreed: number }> | null;

  @Column({
    name: 'cost_usd',
    type: 'numeric',
    precision: 10,
    scale: 4,
    nullable: true,
  })
  costUsd?: string | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs?: number | null;

  /** Free text from whoever ran it: what changed in the prompt, why. */
  @Column({ type: 'text', nullable: true })
  notes?: string | null;
}
