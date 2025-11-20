import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('scenario_path_tenants')
export class ScenarioPathTenant extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioPathId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @DeleteDateColumn()
  deletedAt?: Date;
}
