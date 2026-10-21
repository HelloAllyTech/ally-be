import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('debrief_feedback')
@Unique(['scenarioSessionId'])
export class DebriefFeedback extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  @Column({
    type: 'varchar',
    length: 16,
  })
  rating!: 'positive' | 'negative';

  @Column({ type: 'text', nullable: true })
  comment?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt?: Date | null;
}
