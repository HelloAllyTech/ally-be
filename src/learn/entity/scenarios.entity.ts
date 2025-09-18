import { BaseWithoutTenantEntity } from 'src/common/entities/base-without-tenant.entity';
import { Column, PrimaryGeneratedColumn, Entity } from 'typeorm';
import { ScenarioStatus } from '../enum/scenario.status.enum';

@Entity('scenarios')
export class Scenarios extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  title!: string;

  @Column()
  scenario!: string;

  @Column()
  description!: string;

  @Column()
  coverImageUrl!: string;

  @Column({ enum: ScenarioStatus, default: ScenarioStatus.DRAFT })
  status!: ScenarioStatus;

  @Column({ nullable: true })
  prompt?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;
}
