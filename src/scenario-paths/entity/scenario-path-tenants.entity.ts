import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('scenario_path_tenants')
export class ScenarioPathTenants extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  scenarioPathId!: string;

  @Column()
  tenantId!: string;

  @DeleteDateColumn()
  deletedAt?: Date;
}
