import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ScenarioReportConfig } from '../type/scenario-report-config.type';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { ScenarioReportStatus } from '../enum/scenario-report.enum';

@Entity('scenario_reports')
@Index('idx_scenario_reports_scenario_id', ['scenarioId'], {
  where: '"deletedAt" IS NULL',
})
export class ScenarioReport extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  scenarioId!: number;

  @Column({ enum: ScenarioReportStatus, default: ScenarioReportStatus.STARTED })
  status!: ScenarioReportStatus;

  @Column({ type: 'jsonb' })
  config!: ScenarioReportConfig;

  @Column({ type: 'jsonb', nullable: true })
  metrics?: Record<string, number>;

  @DeleteDateColumn()
  deletedAt?: Date;

  @Column({ type: 'int' })
  createdBy!: number;

  @Column({ type: 'int' })
  updatedBy!: number;

  @Column({ type: 'timestamp', nullable: true })
  endedAt?: Date;
}
