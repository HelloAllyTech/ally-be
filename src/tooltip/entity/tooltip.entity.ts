import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('tooltips')
export class Tooltip extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('uq_tooltips_location_idx', { unique: true })
  @Column()
  location!: string;

  @Column('text')
  tipText!: string;

  @Column({ default: false })
  active!: boolean;

  @Column()
  createdBy!: number;

  @Column()
  updatedBy!: number;
}
