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
}
