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

  /**
   * Whether this prompt is offered as a choice in the studio's variant
   * pickers (Skill Version for `main_agent`, the evaluator picker for
   * `transcript_evaluator`). A future-visibility switch, NOT a capability
   * toggle: scenarios already pointing at this promptCode keep resolving and
   * running on it, because no runtime path reads this flag. `by-type` still
   * returns hidden rows so the studio can resolve a hidden-but-in-use
   * variant's name / states / variables; only the pickers filter.
   *
   * Optional in TS for test ergonomics; the DB column is NOT NULL DEFAULT
   * true, so reads always materialize a boolean.
   */
  @Column({ type: 'boolean', default: true })
  visibleInStudio?: boolean;

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

  /**
   * Prompt-level LLM provider override ('openai' | 'gemini' | 'anthropic').
   * Explicit provider for the model below, so runtimes don't infer it from the
   * model name. Null = infer from the model (backward compatible).
   */
  @Column({ type: 'varchar', nullable: true })
  provider?: string;

  /**
   * Prompt-level LLM model override (e.g. 'gpt-4o', 'gemini-2.5-flash').
   * Sits between the code/language defaults and any simulation-level value
   * in the precedence chain. When null, the call site falls back to its
   * code/language default. Only OpenAI/Gemini models are offered in Studio
   * since those are the providers the voice runtime supports.
   */
  @Column({ type: 'varchar', nullable: true })
  model?: string;

  /**
   * Prompt-level LLM sampling temperature override (0–2). Sits between the
   * code/language defaults and any simulation-level temperature. When null,
   * the call site falls back to its code/language default.
   */
  @Column({
    type: 'numeric',
    nullable: true,
    transformer: {
      to: (value?: number | null) => value ?? null,
      from: (value?: string | null) =>
        value === null || value === undefined ? undefined : parseFloat(value),
    },
  })
  temperature?: number;

  /**
   * Opt-in marker identifying this row as a true English source whose template
   * body should be auto-translated into the eligible Indian languages
   * (`prompt_translations`). Translation is never auto-detected: the trigger,
   * backfill, and runtime self-heal all gate on this flag, so manually-created
   * localized variant rows (indistinguishable from sources by schema) are left
   * untouched unless an admin explicitly enables them.
   *
   * Optional in TS for test ergonomics; the DB column has a NOT NULL default of
   * false, so reads always materialize a boolean.
   */
  @Column({ type: 'boolean', default: false })
  translationEnabled?: boolean;
}
