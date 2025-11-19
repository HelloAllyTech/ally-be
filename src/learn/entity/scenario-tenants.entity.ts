import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('scenario_tenants')
@Index(['scenarioId', 'tenantId'], {
  unique: true,
})
export class ScenarioTenants extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  scenarioId!: number;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @DeleteDateColumn()
  deletedAt?: Date;
}
