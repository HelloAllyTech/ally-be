import { BaseEntity } from 'src/common/entity/base.entity';
import { ScenarioSessionTagCategory } from '../enum/scenario-session-tag-category.enum';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index(
  'uq_scenario_session_message_tags_session_message_tag',
  ['scenarioSessionId', 'messageId', 'tagId'],
  {
    unique: true,
  },
)
@Entity('scenario_session_message_tags')
export class ScenarioSessionMessageTags extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  scenarioSessionId!: string;

  @Column({ type: 'int' })
  messageId!: number;

  @Column({ type: 'uuid' })
  tagId!: string;

  @Column({ enum: ScenarioSessionTagCategory })
  category!: ScenarioSessionTagCategory;
}
