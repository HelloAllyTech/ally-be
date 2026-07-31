import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Named large-language-model configurations — the LLM twin of `stt_configs`.
 *
 * Same rationale: LLM choice used to be a raw jsonb blob per language row, so
 * "the model we use for Kannada" could not be referenced, only restated. A
 * model bump meant editing every copy. Languages and simulations now point at a
 * row here.
 */
@Entity('llm_configs')
@Index('uq_llm_configs_name_idx', ['name'], { unique: true })
export class LlmConfigs extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Human-facing label shown in the admin dropdowns, e.g. "OpenAI — gpt-4o-mini". */
  @Column()
  name!: string;

  /** Provider key; validated against LLM_CONFIG_SCHEMA, which mirrors ally-ai-learn's LLM factory. */
  @Column()
  provider!: string;

  /**
   * Provider settings forwarded verbatim as `scenario.llm.config` — `model`,
   * and optionally `temperature`. Note a simulation-level temperature
   * (scenarios.metadata.temperature) still overrides whatever is set here.
   */
  @Column({ type: 'jsonb', default: {} })
  config!: Record<string, any>;

  /** Inactive rows stay resolvable for sessions but drop out of the pickers. */
  @Column({ default: true })
  active!: boolean;
}
