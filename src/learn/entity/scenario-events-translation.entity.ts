import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('scenario_events_translations')
@Unique('ux_scenario_event_lang', ['scenarioId', 'eventId', 'languageId'])
export class ScenarioEventsTranslation {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'scenarioId' })
  scenarioId!: number;

  @Column({ type: 'varchar', name: 'eventId' })
  eventId!: string;

  @Column({ type: 'int', name: 'languageId' })
  languageId!: number;

  @Column({ type: 'varchar', nullable: true })
  message?: string;

  @Column({ type: 'varchar', nullable: true, name: 'branchInstruction' })
  branchInstruction?: string;

  @CreateDateColumn({ type: 'timestamp', name: 'createdAt' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updatedAt' })
  updatedAt!: Date;
}
