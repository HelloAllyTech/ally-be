import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity({ name: 'session_events_translations' })
@Index(
  'uq_session_events_translations_sessionEventId_languageId_idx',
  ['sessionEventId', 'languageId'],
  {
    unique: true,
  },
)
export class SessionEventsTranslation extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  sessionEventId!: string;

  @Column()
  languageId!: number;

  @Column({ nullable: true })
  message?: string;

  @Column({ nullable: true })
  branchInstruction?: string;

  @Column({ type: 'jsonb', nullable: true })
  detectionData?: Record<string, any>;
}
