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

  @Column({ type: 'jsonb', default: {} })
  llmProviderConfig!: Record<string, any>;

  @Column({ type: 'jsonb', default: {} })
  sttProviderConfig!: Record<string, any>;

  /**
   * Per-language declarative eval config (script, errorRateUnit, targetVariety,
   * diglossia, …). Column added by migration 1829000000002; previously missing
   * from this entity (read only via raw SQL in analytics).
   */
  @Column({ type: 'jsonb', default: {} })
  evalConfig!: Record<string, any>;
}
