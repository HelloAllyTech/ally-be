import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { HelplineSummaryKind } from '../constants/helpline.constants';
import { HelplineTenantScopedEntity } from './helpline-base';

/** One row per (chat, kind), updated in place with `version++`. */
@Entity('helpline_chat_summaries')
@Unique('UQ_helpline_chat_summaries_chat_kind', ['chatId', 'kind'])
export class HelplineChatSummary extends HelplineTenantScopedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'chat_id' })
  chatId!: string;

  @Column({ type: 'varchar', length: 16 })
  kind!: HelplineSummaryKind;

  /**
   * At rest `{ "enc": "<ciphertext of the JSON object>" }`
   * (`HelplineContentCipher.encryptFields`); decrypted to
   * `{ [summaryField.key]: string }` on read. Blanked to `{}` by retention.
   */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  fields!: Record<string, string>;

  @Column({ type: 'int', name: 'through_message_id', default: 0 })
  throughMessageId!: number;

  @Column({ type: 'int', name: 'edited_by', nullable: true })
  editedBy!: number | null;

  @Column({ type: 'int', default: 1 })
  version!: number;
}
