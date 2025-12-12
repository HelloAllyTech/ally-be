import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

@Entity({ name: 'session_events_translations' })
@Unique('session_events_translations_sessionEventId_languageId_key', [
  'sessionEventId',
  'languageId',
])
export class SessionEventsTranslation {
  @PrimaryColumn({ type: 'int' })
  id!: number;

  @Column({ type: 'varchar', name: 'sessionEventId' })
  sessionEventId!: string;

  @Column({ type: 'int', name: 'languageId' })
  languageId!: number;

  @Column({ type: 'varchar', nullable: true })
  message?: string;

  @Column({ type: 'varchar', nullable: true })
  branchInstruction?: string;

  @Column({ type: 'jsonb', nullable: true })
  detectionData?: Record<string, any>;

  @CreateDateColumn({ name: 'createdAt' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updatedAt' })
  updatedAt!: Date;
}
