import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

@Entity('tooltips')
@Index('uq_tooltips_location_idx', ['location'], { unique: true })
export class Tooltip extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  location!: string;

  @Column({ type: 'text' })
  tipText!: string;

  @Column({ type: 'text', nullable: true })
  icon?: string;

  @Column({ type: 'boolean', default: false })
  active!: boolean;

  @Column()
  createdBy!: number;

  @Column()
  updatedBy!: number;
}
