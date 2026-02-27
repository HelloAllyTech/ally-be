import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('global_settings')
export class GlobalSettings extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  name!: string;

  @Column({ type: 'jsonb' })
  value!: Record<string, any>;

  @Column()
  createdBy!: number;

  @Column()
  updatedBy!: number;
}
