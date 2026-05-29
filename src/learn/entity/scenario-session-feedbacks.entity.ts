import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('scenario_session_feedbacks')
export class ScenarioSessionFeedbacks extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  @Column()
  rating!: number;

  @Column({ nullable: true })
  feedback?: string;

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  tags!: string[];
}
