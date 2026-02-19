import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('scenario_report_transcripts')
@Index(
  'idx_scenario_report_transcripts_scenario_report_id',
  ['scenarioReportId'],
  { where: '"deletedAt" IS NULL' },
)
export class ScenarioReportTranscript extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioReportId!: string;

  @Column()
  content!: string;

  @Column({ type: 'float', nullable: true })
  startSeconds?: number;

  @Column()
  role!: string;

  @DeleteDateColumn()
  deletedAt?: Date;
}
