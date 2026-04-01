import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index(
  'scenario_session_recordings_scenario_session_id_uq',
  ['scenarioSessionId'],
  {
    unique: true,
  },
)
@Entity('scenario_session_recordings')
export class ScenarioSessionRecording extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  @Column({ type: 'varchar', length: 1024 })
  storageKey!: string;

  @Column({ type: 'varchar', length: 255 })
  egressId!: string;
}
