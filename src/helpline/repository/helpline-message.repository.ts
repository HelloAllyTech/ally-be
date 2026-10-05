import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Repository } from 'typeorm';
import {
  HELPLINE_RETENTION,
  HelplineMessageType,
  HelplineSenderRole,
  TALKER_VISIBLE_MESSAGE_TYPES,
} from '../constants/helpline.constants';
import { HelplineMessage } from '../entity/helpline-message.entity';

/** Hard ceiling on one transcript read; a text chat this long is already unusual. */
const MAX_MESSAGES_PER_READ = 2000;

/**
 * Every `helpline_messages` query, tenant first (see HelplineChatRepository).
 */
@Injectable()
export class HelplineMessageRepository {
  constructor(
    @InjectRepository(HelplineMessage)
    private readonly repo: Repository<HelplineMessage>,
  ) {}

  findByClientMessageId(
    tenantId: string,
    chatId: string,
    clientMessageId: string,
  ): Promise<HelplineMessage | null> {
    return this.repo.findOne({ where: { tenantId, chatId, clientMessageId } });
  }

  findById(
    tenantId: string,
    chatId: string,
    id: number,
  ): Promise<HelplineMessage | null> {
    return this.repo.findOne({ where: { tenantId, chatId, id } });
  }

  async insert(message: Partial<HelplineMessage>): Promise<HelplineMessage> {
    if (!message.tenantId || !message.chatId) {
      throw new Error('helpline message without tenant_id / chat_id');
    }
    return this.repo.save(this.repo.create(message));
  }

  /** Every row, staff view. */
  listForChat(
    tenantId: string,
    chatId: string,
    afterId = 0,
  ): Promise<HelplineMessage[]> {
    return this.repo.find({
      where: { tenantId, chatId, id: MoreThan(afterId) },
      order: { id: 'ASC' },
      take: MAX_MESSAGES_PER_READ,
    });
  }

  /**
   * Talker-visible rows only. The serialiser filters again — this narrows the
   * read, it is not the guard.
   */
  listTalkerVisible(
    tenantId: string,
    chatId: string,
    afterId = 0,
  ): Promise<HelplineMessage[]> {
    return this.repo.find({
      where: {
        tenantId,
        chatId,
        id: MoreThan(afterId),
        visibleToTalker: true,
        type: In([...TALKER_VISIBLE_MESSAGE_TYPES]),
      },
      order: { id: 'ASC' },
      take: MAX_MESSAGES_PER_READ,
    });
  }

  /** TEXT turns for a summary, oldest first, excluding erased bodies. */
  listTextTurns(tenantId: string, chatId: string): Promise<HelplineMessage[]> {
    return this.repo.find({
      where: {
        tenantId,
        chatId,
        type: HelplineMessageType.TEXT,
        erasedAt: IsNull(),
      },
      order: { id: 'ASC' },
      take: MAX_MESSAGES_PER_READ,
    });
  }

  /** The first talker TEXT of each chat — the lobby preview. */
  async firstTalkerTexts(
    tenantId: string,
    chatIds: string[],
  ): Promise<Map<string, HelplineMessage>> {
    if (!chatIds.length) return new Map();
    const rows: HelplineMessage[] = await this.repo
      .createQueryBuilder('m')
      .distinctOn(['m.chatId'])
      .where('m.tenantId = :tenantId', { tenantId })
      .andWhere('m.chatId IN (:...chatIds)', { chatIds })
      .andWhere('m.senderRole = :role', { role: HelplineSenderRole.TALKER })
      .andWhere('m.type = :type', { type: HelplineMessageType.TEXT })
      .andWhere('m.erasedAt IS NULL')
      .orderBy('m.chatId')
      .addOrderBy('m.id', 'ASC')
      .getMany();
    return new Map(rows.map((row) => [row.chatId, row]));
  }

  async maxId(tenantId: string, chatId: string): Promise<number> {
    const row = await this.repo
      .createQueryBuilder('m')
      .select('MAX(m.id)', 'max')
      .where('m.tenantId = :tenantId', { tenantId })
      .andWhere('m.chatId = :chatId', { chatId })
      .getRawOne<{ max: number | null }>();
    return Number(row?.max ?? 0);
  }

  /**
   * Blank every body in these chats (retention and erasure, contract §10).
   * Suggestion text in `metadata.suggestions` goes too — it is model output
   * about the conversation. Idempotent: a re-run touches nothing it already
   * blanked. Returns the number of rows changed.
   */
  async blankForChats(tenantId: string, chatIds: string[]): Promise<number> {
    if (!chatIds.length) return 0;
    const result = await this.repo.query(
      `UPDATE "helpline_messages"
          SET "content" = $3,
              "metadata" = CASE WHEN "metadata" ? 'suggestions'
                THEN "metadata" - 'suggestions' ELSE "metadata" END,
              "erased_at" = COALESCE("erased_at", now()), "updated_at" = now()
        WHERE "tenant_id" = $1 AND "chat_id" = ANY($2::uuid[])
          AND ("content" <> $3 OR "erased_at" IS NULL)`,
      [tenantId, chatIds, HELPLINE_RETENTION.ERASED],
    );
    return Array.isArray(result) && typeof result[1] === 'number'
      ? result[1]
      : 0;
  }
}
