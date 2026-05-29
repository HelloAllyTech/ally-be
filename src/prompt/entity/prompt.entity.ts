import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Richer per-variable metadata used by the studio to render labels and
 * enforce mandatoriness. Legacy entries may still be bare strings; readers
 * should accept both shapes via {@link normalizeAvailableVariable}.
 */
export interface AvailableVariable {
  /** Placeholder name as it appears in the prompt text (`{name}`). */
  name: string;
  /** Optional display label shown in the studio editor. */
  label?: string;
  /** Whether the studio should treat this field as required. */
  required?: boolean;
}

export type AvailableVariableEntry = string | AvailableVariable;

@Entity('prompts')
@Index('uq_prompts_name_idx', ['name'], { unique: true })
@Index('uq_prompts_code_idx', ['promptCode'], { unique: true })
export class Prompt extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  promptCode!: string;

  @Column()
  name!: string;

  @Column()
  description!: string;

  @Column({ type: 'varchar', nullable: true })
  category?: string;

  @Column({ nullable: true })
  currentVersion?: number;

  @Column({ type: 'text', nullable: true })
  defaultPrompt?: string;

  @Column({ type: 'boolean', default: false })
  useDashboardOverride!: boolean;

  @Column({ type: 'boolean', default: false })
  isObsolete!: boolean;

  @Column({ type: 'varchar', nullable: true })
  kind?: string;

  /**
   * Role/category of this prompt in the agent pipeline.
   * Examples: 'main_agent', 'branching', 'multilingual'.
   * Multiple rows may share a promptType (variants); each row still has a
   * unique promptCode. The studio prompt picker lists rows by promptType.
   * Nullable until backfilled; orthogonal to `kind` (which distinguishes
   * 'prompt' vs 'block').
   */
  @Column({ type: 'varchar', nullable: true })
  @Index('idx_prompts_prompt_type')
  promptType?: string;

  /**
   * When true, the prompt expects a States section. Studio renders the
   * states editor; runtime resolves the active state by turn score and
   * substitutes its guidelines into `{state_x_guidelines}`, gating RAG
   * per state's ragEnabled. Independent of `behaviorInstructions`-based
   * state guidance, which continues to work in parallel.
   *
   * Optional in TS for test ergonomics; the DB column has a NOT NULL
   * default of false, so reads always materialize a boolean.
   */
  @Column({ type: 'boolean', default: false })
  hasStates?: boolean;

  /**
   * List of placeholder variables used by this prompt. May contain bare
   * strings (legacy) or `AvailableVariable` objects with label / required
   * metadata used by the studio. The runtime only needs the names.
   */
  @Column({ type: 'jsonb', nullable: true })
  availableVariables?: AvailableVariableEntry[];

  @Column({ type: 'jsonb', nullable: true })
  usesBlocks?: string[];
}
