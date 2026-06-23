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

  // The scenario_versions row whose config produced this report. Lets admins
  // compare a version's runs by reading the reports tagged to it.
  @Column({ type: 'uuid', nullable: true })
  scenarioVersionId?: string | null;

  @Column({ enum: ScenarioReportStatus, default: ScenarioReportStatus.STARTED })
  status!: ScenarioReportStatus;

  @Column({ type: 'jsonb' })
  config!: ScenarioReportConfig;

  @Column({ type: 'jsonb', nullable: true })
  metrics?: Record<string, number>;

  @Column({ type: 'text', nullable: true })
  reportMarkdown?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @DeleteDateColumn()
  deletedAt?: Date;

  @Column({ type: 'int' })
  createdBy!: number;

  @Column({ type: 'int' })
  updatedBy!: number;

  @Column({ type: 'timestamp', nullable: true })
  endedAt?: Date;
}
