import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('scenario_path_items')
export class ScenarioPathItems extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  scenarioPathId!: string;

  @Column()
  scenarioId!: number;

  @Column()
  order!: number;

  @Column({ nullable: true })
  message?: string;

  @Column({ nullable: true })
  minimumScore?: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
