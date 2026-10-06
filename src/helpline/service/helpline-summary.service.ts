import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiService } from 'src/ai/service/ai.service';
import { MessageRequest } from 'src/ai/dto/ai.request.dto';
import { LoggerService } from 'src/logger/logger.service';
import {
  HELPLINE_LIMITS,
  HELPLINE_TIMINGS,
  HelplineRooms,
  HelplineSenderRole,
  HelplineServerEvents,
  HelplineSummaryKind,
} from '../constants/helpline.constants';
import { HelplineChatSummary } from '../entity/helpline-chat-summary.entity';
import { HelplineChat } from '../entity/helpline-chat.entity';
import { HelplineMessage } from '../entity/helpline-message.entity';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import { HelplineMessageRepository } from '../repository/helpline-message.repository';
import { HelplineSummaryField, SummaryDto } from '../type/helpline.types';
import { badRequest, chatEnded, returningRows } from '../util/helpline-errors';
import { HelplineChatViewService } from './helpline-chat-view.service';
import { HelplineContentCipher } from './helpline-content-cipher.service';
import { HelplineRealtimeService } from './helpline-realtime.service';
import { HelplineSettingsService } from './helpline-settings.service';
import { HelplineTenantService } from './helpline-tenant.service';

const SUMMARY_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Turns into ally-ai `/summary/note` chat history: TEXT turns only, in the
 * two roles the existing Scribe callers use (`CLIENT` / `COUNSELOR`).
 */
export function toSummaryHistory(
  messages: HelplineMessage[],
): MessageRequest[] {
  return messages
    .filter((m) => m.erasedAt == null && m.content.trim())
    .map((m) => ({
      role: m.senderRole === HelplineSenderRole.TALKER ? 'CLIENT' : 'COUNSELOR',
      content: m.content,
    }));
}

/**
 * ally-ai answers `{ fields: {...} }` when `keys` are given
 * (`DynamicSummaryNoteResponse`). Keep only the org's keys, as strings.
 */
export function coerceSummaryFields(
  response: unknown,
  fields: HelplineSummaryField[],
): Record<string, string> | null {
  if (!response || typeof response !== 'object') return null;
  const source =
    (response as { fields?: unknown }).fields &&
    typeof (response as { fields?: unknown }).fields === 'object'
      ? (response as { fields: Record<string, unknown> }).fields
      : (response as Record<string, unknown>);
  const out: Record<string, string> = {};
  for (const { key } of fields) {
    const value = source[key];
    if (value == null) continue;
    const text =
      typeof value === 'string'
        ? value.trim()
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : JSON.stringify(value);
    if (text) out[key] = text.slice(0, HELPLINE_LIMITS.SUMMARY_VALUE_MAX_CHARS);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Chat summaries. Phase 1 writes FINAL (after the chat ends, and when a
 * listener edits it); ROLLING and HANDOFF use the same table and the same
 * ally-ai call from the copilot pass.
 */
@Injectable()
export class HelplineSummaryService {
  private readonly logger = LoggerService.getInstance(
    HelplineSummaryService.name,
  );

  constructor(
    @InjectRepository(HelplineChatSummary)
    private readonly summaries: Repository<HelplineChatSummary>,
    private readonly chats: HelplineChatRepository,
    private readonly messages: HelplineMessageRepository,
    private readonly tenants: HelplineTenantService,
    private readonly settings: HelplineSettingsService,
    private readonly views: HelplineChatViewService,
    private readonly realtime: HelplineRealtimeService,
    private readonly aiService: AiService,
    private readonly cipher: HelplineContentCipher,
  ) {}

  /** Fire-and-forget from endChat. Never throws. */
  scheduleFinal(chat: HelplineChat): void {
    this.schedule(chat, HelplineSummaryKind.FINAL);
  }

  /** Fire-and-forget every N talker turns (contract §9.2 step 4). Never throws. */
  scheduleRolling(chat: Pick<HelplineChat, 'id' | 'tenantId'>): void {
    this.schedule(chat, HelplineSummaryKind.ROLLING);
  }

  /** Fire-and-forget on a transfer request, for the next listener. Never throws. */
  scheduleHandoff(chat: Pick<HelplineChat, 'id' | 'tenantId'>): void {
    this.schedule(chat, HelplineSummaryKind.HANDOFF);
  }

  private schedule(
    chat: Pick<HelplineChat, 'id' | 'tenantId'>,
    kind: HelplineSummaryKind,
  ): void {
    void this.generate(chat.tenantId, chat.id, kind).catch((error) =>
      this.logger.error(
        `${kind} summary failed for chat ${chat.id}: ${(error as Error).message}`,
      ),
    );
  }

  /** Kept for callers and specs that name the FINAL summary. */
  generateFinal(tenantId: string, chatId: string): Promise<SummaryDto | null> {
    return this.generate(tenantId, chatId, HelplineSummaryKind.FINAL);
  }

  /**
   * Generate and store one model-written summary (ROLLING, HANDOFF or FINAL)
   * from the chat's TEXT turns so far. On any failure there is simply no new
   * row — the listener sees the previous version or an empty, editable form,
   * which is the designed fallback (contract §11). The request carries the
   * conversation, so it is redacted from the AI service's logs.
   */
  async generate(
    tenantId: string,
    chatId: string,
    kind: HelplineSummaryKind,
  ): Promise<SummaryDto | null> {
    const chat = await this.chats.findById(tenantId, chatId);
    if (!chat || chat.erasedAt) return null;
    const tenant = await this.tenants.resolve(tenantId);
    if (!tenant) return null;
    const settings = await this.settings.getSettings(tenant);

    const turns = await this.messages.listTextTurns(tenantId, chatId);
    const history = toSummaryHistory(turns);
    if (!history.length) return null;

    const keys = settings.summaryFields.map((f) => f.key);
    const descriptions = Object.fromEntries(
      settings.summaryFields.map((f) => [
        f.key,
        f.description ? `${f.label}: ${f.description}` : f.label,
      ]),
    );
    const timeoutMs =
      kind === HelplineSummaryKind.FINAL
        ? HELPLINE_TIMINGS.SUMMARY_TIMEOUT_MS
        : HELPLINE_TIMINGS.ROLLING_SUMMARY_TIMEOUT_MS;

    let response: unknown;
    try {
      response = await withTimeout(
        this.aiService.generateSummaryAndTags(
          history,
          undefined,
          keys,
          descriptions,
          { redactBody: true, timeoutMs },
        ),
        timeoutMs,
      );
    } catch (error) {
      this.logger.warn(
        `${kind} summary call failed for chat ${chatId}: ${(error as Error).message}`,
      );
      return null;
    }
    const fields = coerceSummaryFields(response, settings.summaryFields);
    if (!fields) {
      this.logger.warn(`${kind} summary for chat ${chatId} came back empty`);
      return null;
    }

    const throughMessageId = turns[turns.length - 1]?.id ?? 0;
    const written = await this.upsertGenerated(
      tenantId,
      chatId,
      kind,
      fields,
      throughMessageId,
    );
    if (!written) return null;
    const dto = await this.views.summaryDto(written);
    await this.realtime.emit(
      HelplineRooms.staff(chatId),
      HelplineServerEvents.SUMMARY_UPDATED,
      { chatId, summary: dto },
    );
    return dto;
  }

  /** The decrypted fields of one stored summary, or null. */
  async readFields(
    tenantId: string,
    chatId: string,
    kind: HelplineSummaryKind,
  ): Promise<Record<string, string> | null> {
    const row = await this.summaries.findOne({
      where: { tenantId, chatId, kind },
    });
    return row ? this.cipher.decryptFields(row.fields) : null;
  }

  /**
   * Upsert a model-written summary. Two guards in the statement itself, so a
   * slow generation cannot race them:
   *  - never over a listener's edit (`edited_by IS NULL` on conflict);
   *  - never into an erased chat (the NOT EXISTS on `erased_at`).
   *
   * `fields` arrive in plaintext and are stored encrypted (`{ enc }`); the
   * returned row still holds the stored form — read it through `summaryDto`.
   */
  async upsertGenerated(
    tenantId: string,
    chatId: string,
    kind: HelplineSummaryKind,
    fields: Record<string, string>,
    throughMessageId: number,
  ): Promise<HelplineChatSummary | null> {
    const result = await this.summaries.query(
      `INSERT INTO "helpline_chat_summaries" ("tenant_id", "chat_id", "kind", "fields", "through_message_id")
       SELECT $1::varchar, $2::uuid, $3::varchar, $4::jsonb, $5::int
        WHERE NOT EXISTS (
          SELECT 1 FROM "helpline_chats" WHERE "id" = $2::uuid AND "tenant_id" = $1::varchar AND "erased_at" IS NOT NULL
        )
       ON CONFLICT ("chat_id", "kind") DO UPDATE
         SET "fields" = EXCLUDED."fields",
             "through_message_id" = EXCLUDED."through_message_id",
             "version" = "helpline_chat_summaries"."version" + 1,
             "updated_at" = now()
       WHERE "helpline_chat_summaries"."edited_by" IS NULL
         AND "helpline_chat_summaries"."tenant_id" = $1::varchar
      RETURNING "id"`,
      [
        tenantId,
        chatId,
        kind,
        JSON.stringify(await this.cipher.encryptFields(fields)),
        throughMessageId,
      ],
    );
    const id = returningRows<{ id: string }>(result)[0]?.id;
    if (!id) return null;
    return this.summaries.findOne({ where: { id, tenantId } });
  }

  /** PUT /chats/:id/summary — the listener's own words win from here on. */
  async saveFinalEdit(
    chat: HelplineChat,
    userId: number,
    fields: unknown,
  ): Promise<SummaryDto> {
    if (chat.erasedAt) throw chatEnded('This conversation was erased');
    const clean = validateSummaryEdit(fields);
    const existing = await this.summaries.findOne({
      where: {
        tenantId: chat.tenantId,
        chatId: chat.id,
        kind: HelplineSummaryKind.FINAL,
      },
    });
    const throughMessageId =
      existing?.throughMessageId ||
      (await this.messages.maxId(chat.tenantId, chat.id));
    const stored = (await this.cipher.encryptFields(clean)) as Record<
      string,
      string
    >;
    const row = await this.summaries.save(
      existing
        ? Object.assign(existing, {
            fields: stored,
            editedBy: userId,
            version: existing.version + 1,
            throughMessageId,
          })
        : this.summaries.create({
            tenantId: chat.tenantId,
            chatId: chat.id,
            kind: HelplineSummaryKind.FINAL,
            fields: stored,
            editedBy: userId,
            version: 1,
            throughMessageId,
          }),
    );
    const dto = await this.views.summaryDto(row);
    await this.realtime.emit(
      HelplineRooms.staff(chat.id),
      HelplineServerEvents.SUMMARY_UPDATED,
      { chatId: chat.id, summary: dto },
    );
    return dto;
  }
}

/**
 * Keys must look like summary keys; any key is accepted (the org may have
 * changed its fields since this chat), values are capped.
 */
export function validateSummaryEdit(fields: unknown): Record<string, string> {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw badRequest('fields must be an object of text values');
  }
  const entries = Object.entries(fields as Record<string, unknown>);
  if (entries.length > HELPLINE_LIMITS.SUMMARY_MAX_FIELDS) {
    throw badRequest(`at most ${HELPLINE_LIMITS.SUMMARY_MAX_FIELDS} fields`);
  }
  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!SUMMARY_KEY.test(key)) throw badRequest(`invalid field key "${key}"`);
    if (typeof value !== 'string')
      throw badRequest(`field "${key}" must be text`);
    if (value.length > HELPLINE_LIMITS.SUMMARY_VALUE_MAX_CHARS) {
      throw badRequest(
        `field "${key}" must be at most ${HELPLINE_LIMITS.SUMMARY_VALUE_MAX_CHARS} characters`,
      );
    }
    out[key] = value;
  }
  return out;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${ms} ms`)),
          ms,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
