import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { HelplineTenantScopedEntity } from './helpline-base';

/** The talker's one-question rating of an ended chat. Once per chat. */
@Entity('helpline_talker_feedback')
export class HelplineTalkerFeedback extends HelplineTenantScopedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'chat_id', unique: true })
  chatId!: string;

  /** 1–5. */
  @Column({ type: 'smallint' })
  rating!: number;

  /** Blanked by retention. */
  @Column({ type: 'varchar', length: 1000, nullable: true })
  comment!: string | null;
}
