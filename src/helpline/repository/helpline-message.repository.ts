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
import { HelplineContentCipher } from '../service/helpline-content-cipher.service';
import { returningRows } from '../util/helpline-errors';

/** Hard ceiling on one transcript read; a text chat this long is already unusual. */
const MAX_MESSAGES_PER_READ = 2000;

/** Decrypt one row in place: the body and any suggestion text in its metadata. */
async function decryptRow(
  cipher: HelplineContentCipher,
  row: HelplineMessage,
): Promise<HelplineMessage> {
  row.content = await cipher.decrypt(row.content, 'helpline_messages.content');
  row.metadata = await cipher.decryptMetadata(row.metadata);
  return row;
}

async function decryptRows(
  cipher: HelplineContentCipher,
  rows: HelplineMessage[],
): Promise<HelplineMessage[]> {
  return Promise.all(rows.map((row) => decryptRow(cipher, row)));
}

/**
 * Every `helpline_messages` query, tenant first (see HelplineChatRepository).
 *
 * Also the one place message PHI crosses the encryption boundary (contract
 * §4): `insert` stores the body (and any `metadata.suggestions[].text`)
 * encrypted and hands the caller back the row with its PLAINTEXT, and every
 * read decrypts before returning. Nothing above this class ever sees
 * ciphertext, so the keyword screen, risk offsets, previews and LLM context
 * all keep working on the text the talker typed.
 */
@Injectable()
export class HelplineMessageRepository {
  constructor(
    @InjectRepository(HelplineMessage)
    private readonly repo: Repository<HelplineMessage>,
    private readonly cipher: HelplineContentCipher,
  ) {}

  async findByClientMessageId(
    tenantId: string,
    chatId: string,
    clientMessageId: string,
  ): Promise<HelplineMessage | null> {
    const row = await this.repo.findOne({
      where: { tenantId, chatId, clientMessageId },
    });
    return row ? decryptRow(this.cipher, row) : null;
  }

  async findById(
    tenantId: string,
    chatId: string,
    id: number,
  ): Promise<HelplineMessage | null> {
    const row = await this.repo.findOne({ where: { tenantId, chatId, id } });
    return row ? decryptRow(this.cipher, row) : null;
  }

  /** Rows by id across the tenant's chats (the calibration view's signals). */
  async findByIds(tenantId: string, ids: number[]): Promise<HelplineMessage[]> {
    const unique = [...new Set(ids.filter((id) => Number.isInteger(id)))];
    if (!unique.length) return [];
    const rows = await this.repo.find({
      where: { tenantId, id: In(unique) },
    });
    return decryptRows(this.cipher, rows);
  }

  /**
   * Persist encrypted, return plaintext. The returned entity carries the
   * caller's original content and metadata, not the stored ciphertext.
   */
  async insert(message: Partial<HelplineMessage>): Promise<HelplineMessage> {
    if (!message.tenantId || !message.chatId) {
      throw new Error('helpline message without tenant_id / chat_id');
    }
    const plainContent = message.content ?? '';
    const plainMetadata = message.metadata ?? null;
    const saved = await this.repo.save(
      this.repo.create({
        ...message,
        content: await this.cipher.encrypt(plainContent),
        metadata: await this.cipher.encryptMetadata(plainMetadata),
      }),
    );
    return Object.assign(saved, {
      content: plainContent,
      metadata: plainMetadata,
    });
  }

  /** Every row, staff view. */
  async listForChat(
    tenantId: string,
    chatId: string,
    afterId = 0,
  ): Promise<HelplineMessage[]> {
    const rows = await this.repo.find({
      where: { tenantId, chatId, id: MoreThan(afterId) },
      order: { id: 'ASC' },
      take: MAX_MESSAGES_PER_READ,
    });
    return decryptRows(this.cipher, rows);
  }

  /**
   * Talker-visible rows only. The serialiser filters again — this narrows the
   * read, it is not the guard.
   */
  async listTalkerVisible(
    tenantId: string,
    chatId: string,
    afterId = 0,
  ): Promise<HelplineMessage[]> {
    const rows = await this.repo.find({
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
    return decryptRows(this.cipher, rows);
  }

  /** TEXT turns for a summary or the QA judge, oldest first, excluding erased bodies. */
  async listTextTurns(
    tenantId: string,
    chatId: string,
  ): Promise<HelplineMessage[]> {
    const rows = await this.repo.find({
      where: {
        tenantId,
        chatId,
        type: HelplineMessageType.TEXT,
        erasedAt: IsNull(),
      },
      order: { id: 'ASC' },
      take: MAX_MESSAGES_PER_READ,
    });
    return decryptRows(this.cipher, rows);
  }

  /** The last `limit` TEXT turns, oldest first (copilot context). */
  async recentTextTurns(
    tenantId: string,
    chatId: string,
    limit: number,
  ): Promise<HelplineMessage[]> {
    const rows = await this.repo.find({
      where: {
        tenantId,
        chatId,
        type: HelplineMessageType.TEXT,
        erasedAt: IsNull(),
      },
      order: { id: 'DESC' },
      take: limit,
    });
    return decryptRows(this.cipher, rows.reverse());
  }

  /** The newest row of one staff-only type (e.g. the current STAGE). */
  async latestOfType(
    tenantId: string,
    chatId: string,
    type: HelplineMessageType,
  ): Promise<HelplineMessage | null> {
    const row = await this.repo.findOne({
      where: { tenantId, chatId, type },
      order: { id: 'DESC' },
    });
    return row ? decryptRow(this.cipher, row) : null;
  }

  /** The staff-only RISK markers written on one talker message (one per counted hit). */
  async listRiskMarkers(
    tenantId: string,
    chatId: string,
    parentMessageId: number,
  ): Promise<HelplineMessage[]> {
    const rows = await this.repo.find({
      where: {
        tenantId,
        chatId,
        parentMessageId,
        type: HelplineMessageType.RISK,
      },
      order: { id: 'ASC' },
    });
    return decryptRows(this.cipher, rows);
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
    await decryptRows(this.cipher, rows);
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
   * The listener sent suggestion `index` of this SUGGESTION row: add it to
   * `metadata.accepted` (a set). In SQL, so it never touches the encrypted
   * suggestion text and cannot lose a concurrent feedback write.
   */
  async markSuggestionAccepted(
    tenantId: string,
    chatId: string,
    messageId: number,
    index: number,
  ): Promise<boolean> {
    const result = await this.repo.query(
      `UPDATE "helpline_messages"
          SET "metadata" = jsonb_set(COALESCE("metadata", '{}'::jsonb), '{accepted}',
                (SELECT COALESCE(jsonb_agg(DISTINCT v ORDER BY v), '[]'::jsonb)
                   FROM jsonb_array_elements(
                     CASE WHEN jsonb_typeof("metadata"->'accepted') = 'array'
                          THEN "metadata"->'accepted' ELSE '[]'::jsonb END
                     || to_jsonb($4::int)) AS v)),
              "updated_at" = now()
        WHERE "tenant_id" = $1 AND "chat_id" = $2 AND "id" = $3
          AND "type" = 'SUGGESTION' AND "erased_at" IS NULL
      RETURNING "id"`,
      [tenantId, chatId, messageId, index],
    );
    return returningRows(result).length === 1;
  }

  /**
   * A listener's thumbs on a copilot row (contract §5.3 copilot-feedback):
   * SUGGESTION → `metadata.feedback[index]`, NUDGE → `metadata.feedback`.
   * The latest rating wins.
   */
  async setCopilotFeedback(
    tenantId: string,
    chatId: string,
    messageId: number,
    type: HelplineMessageType.SUGGESTION | HelplineMessageType.NUDGE,
    index: number | null,
    rating: 'UP' | 'DOWN',
  ): Promise<boolean> {
    const suggestion = type === HelplineMessageType.SUGGESTION;
    // Parameters are listed per shape: Postgres refuses a statement carrying a
    // parameter it never references (its type cannot be inferred).
    const value = suggestion
      ? `COALESCE(CASE WHEN jsonb_typeof("metadata"->'feedback') = 'object'
            THEN "metadata"->'feedback' END, '{}'::jsonb)
           || jsonb_build_object($6::text, $5::text)`
      : `to_jsonb($5::text)`;
    const params: unknown[] = [tenantId, chatId, messageId, type, rating];
    if (suggestion) params.push(String(index ?? 0));
    const result = await this.repo.query(
      `UPDATE "helpline_messages"
          SET "metadata" = jsonb_set(COALESCE("metadata", '{}'::jsonb), '{feedback}', ${value}),
              "updated_at" = now()
        WHERE "tenant_id" = $1 AND "chat_id" = $2 AND "id" = $3 AND "type" = $4
          AND "erased_at" IS NULL
      RETURNING "id"`,
      params,
    );
    return returningRows(result).length === 1;
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
