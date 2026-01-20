import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('user_daily_scores')
@Index(
  'uq_user_daily_scores_user_id_tenant_id_date_idx',
  ['userId', 'tenantId', 'date'],
  { unique: true },
)
@Index('user_daily_scores_tenant_id_date_idx', ['tenantId', 'date'])
export class UserDailyScores extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: number;

  @Column({ type: 'date' })
  date!: Date;

  @Column({ type: 'int', default: 0 })
  minutesPlayed!: number;

  @Column({ type: 'int', default: 0 })
  totalScore!: number;
}
