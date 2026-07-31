import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Named speech-to-text configurations, the STT counterpart to `scenario_voices`.
 *
 * Before this table, STT lived as a raw jsonb blob on each language row, which
 * meant every place that wanted to talk about "the provider we use for Kannada"
 * had to restate the whole `{ provider, config }` object. Languages and
 * simulations now reference a row here by id, so a provider or model change is
 * made once and every consumer follows.
 *
 * Deliberately not scoped per language: the same config (say Google chirp_2 in
 * asia-southeast1) is shared across many languages, and the session language is
 * passed to the provider at runtime rather than baked in here. The exception is
 * `config.languageCode`, which exists for providers that need a script-qualified
 * code that differs from the session language (Google's 'pa-Guru-IN').
 */
@Entity('stt_configs')
@Index('uq_stt_configs_name_idx', ['name'], { unique: true })
export class SttConfigs extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Human-facing label shown in the admin dropdowns, e.g. "Google — chirp_2". */
  @Column()
  name!: string;

  /** Provider key; validated against STT_CONFIG_SCHEMA, which mirrors ally-ai-learn's STT factory. */
  @Column()
  provider!: string;

  /**
   * Provider settings forwarded verbatim as `scenario.stt.config`. `model` is
   * required — see ScenarioSttProviderSettingsDto for why a missing model is
   * worse than no override at all.
   */
  @Column({ type: 'jsonb', default: {} })
  config!: Record<string, any>;

  /** Inactive rows stay resolvable for sessions but drop out of the pickers. */
  @Column({ default: true })
  active!: boolean;
}
