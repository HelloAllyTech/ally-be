import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Catalog of the LLMs the platform offers — the DB home of what used to be the
 * hardcoded `LLM_MODEL_REGISTRY` array.
 *
 * Distinct from `llm_configs`, which is a *choice* ("the config Kannada uses").
 * Several configs may name the same model at different temperatures; this table
 * has one row per model, so "does gpt-4o-mini still work" is one question with
 * one answer.
 *
 * Deliberately NOT stored here: which runtimes can execute the model. That is a
 * property of deployed code — ai-learn has no Anthropic branch — and lives in
 * `PROVIDER_RUNTIME_MATRIX`. Adding a model is data; adding a provider is a code
 * change, because it is one. See docs/prompt-llm-config-standardization-adr.md.
 */
@Entity('llm_models')
@Index('uq_llm_models_provider_model_idx', ['provider', 'model'], {
  unique: true,
})
export class LlmModels extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Provider key: 'openai' | 'gemini' | 'anthropic'. */
  @Column()
  provider!: string;

  /** Model id passed to the provider, e.g. 'gpt-4o-mini'. */
  @Column()
  model!: string;

  /** Human-readable label for pickers, e.g. 'GPT-4o mini'. */
  @Column()
  label!: string;

  /**
   * Whether the model accepts a custom temperature.
   *
   * Seeded from `modelSupportsTemperature`, which is only a guess at the model
   * name (`o1`/`o3`/`o4`/`gpt-5`). Stored so a wrong guess for a newly released
   * model can be corrected without a deploy. Safe either way: `resolveTemperature`
   * omits the value when false, and ai-learn drops a temperature the provider
   * rejects rather than failing the call.
   */
  @Column({ default: true })
  supportsTemperature!: boolean;

  /** Inactive models stay resolvable for anything already pointing at them, but
   *  drop out of the pickers — the same convention as the config registries. */
  @Column({ default: true })
  active!: boolean;
}
