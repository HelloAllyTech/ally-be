import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('languages')
@Index('uq_languages_value_idx', ['value'], { unique: true })
export class Languages extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  value!: string;

  @Column()
  label!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ default: '' })
  translationCode!: string;

  /**
   * @deprecated Superseded by `llmConfigId` (the llm_configs registry). Still
   * read as a fallback for rows the registry migration could not map; dropped
   * once nothing reads it.
   */
  @Column({ type: 'jsonb', default: {} })
  llmProviderConfig!: Record<string, any>;

  /** This language's default LLM, referencing the llm_configs registry. */
  @Column({ type: 'uuid', nullable: true })
  llmConfigId?: string | null;

  /**
   * @deprecated Superseded by `sttConfigId` (the stt_configs registry). Still
   * read as a fallback for rows the registry migration could not map; dropped
   * once nothing reads it.
   */
  @Column({ type: 'jsonb', default: {} })
  sttProviderConfig!: Record<string, any>;

  /** This language's default STT, referencing the stt_configs registry. */
  @Column({ type: 'uuid', nullable: true })
  sttConfigId?: string | null;

  /**
   * Per-language declarative eval config (script, errorRateUnit, targetVariety,
   * diglossia, …). Column added by migration 1829000000002; previously missing
   * from this entity (read only via raw SQL in analytics).
   */
  @Column({ type: 'jsonb', default: {} })
  evalConfig!: Record<string, any>;
}
