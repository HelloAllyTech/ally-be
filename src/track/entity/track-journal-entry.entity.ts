import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One row per (progress row, prompt) — mirrors the
 * scenario_session_reflection_prompt_response pattern. A row with null
 * submittedAt is a draft; journal submit stamps all rows.
 */
@Entity('track_journal_entries')
export class TrackJournalEntry extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  trackItemProgressId!: string;

  @Column({ type: 'uuid' })
  trackItemId!: string;

  @Column()
  userId!: number;

  @Column()
  promptId!: string;

  @Column({ type: 'text', nullable: true })
  response?: string;

  @Column({ type: 'timestamp', nullable: true })
  submittedAt?: Date;

  @DeleteDateColumn()
  deletedAt?: Date;
}
