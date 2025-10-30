import { Column, Entity, PrimaryColumn, DeleteDateColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entities/base-without-tenant.entity';

@Entity('scenario_events')
export class ScenarioEvents extends BaseWithoutTenantEntity {
  @PrimaryColumn()
  scenarioId!: number;

  @PrimaryColumn()
  eventId!: string;

  @Column({ nullable: true })
  feedbackStatus?: boolean;

  @Column({ nullable: true })
  emoji?: string;

  @Column({ nullable: true })
  message?: string;

  @Column({ nullable: true })
  score?: number;

  @Column({ nullable: true })
  branchingStatus?: boolean;

  @Column({ nullable: true })
  branchInstruction?: string;

  @DeleteDateColumn()
  deletedAt?: Date;
}
