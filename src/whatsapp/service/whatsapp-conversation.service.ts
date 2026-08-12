import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { CreateKbDocumentDto } from 'src/knowledge-base/dto/knowledge-base.dto';
import { KbDocumentSourceType } from 'src/knowledge-base/enum/knowledge-base.enum';
import { KnowledgeBaseService } from 'src/knowledge-base/service/knowledge-base.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import { WaContact } from '../entity/wa-contact.entity';
import { WaConversation } from '../entity/wa-conversation.entity';
import { WaMessage } from '../entity/wa-message.entity';
import { WaUnansweredQuestion } from '../entity/wa-unanswered-question.entity';
import {
  WaHandledBy,
  WaUnansweredReason,
  WaUnansweredStatus,
} from '../enum/whatsapp.enum';
import { WaAnalyticsRepository } from '../repository/wa-analytics.repository';
import { resolveSort } from 'src/common/util/sort.util';
import { ERASED, ERASED_PHONE_PREFIX } from './whatsapp-retention.service';

/**
 * Read side of the conversation log, the unanswered queue and the usage dashboard.
 *
 * Phone numbers are MASKED by default in everything this service returns. A full number is only ever
 * emitted by `revealContactPhone`, which is a separate, separately-logged call — the log is
 * identifiable data about mental healthcare workers, and a screen an admin might screenshot should
 * not carry it by default.
 */
@Injectable()
export class WhatsAppConversationService {
  private readonly logger = LoggerService.getInstance(
    WhatsAppConversationService.name,
  );

  constructor(
    @InjectRepository(WaContact)
    private readonly contactRepository: Repository<WaContact>,
    @InjectRepository(WaConversation)
    private readonly conversationRepository: Repository<WaConversation>,
    @InjectRepository(WaMessage)
    private readonly messageRepository: Repository<WaMessage>,
    @InjectRepository(WaUnansweredQuestion)
    private readonly unansweredRepository: Repository<WaUnansweredQuestion>,
    private readonly analyticsRepository: WaAnalyticsRepository,
    private readonly knowledgeBaseService: KnowledgeBaseService,
  ) {}

  // ── conversations ─────────────────────────────────────────────────────

  async listConversations(options: {
    limit?: number;
    offset?: number;
    from?: Date;
    to?: Date;
    handledBy?: WaHandledBy;
    language?: string;
    declinedOnly?: boolean;
    search?: string;
    sortBy?: string;
    sortDir?: string;
  }) {
    const limit = options.limit ?? 25;
    const offset = options.offset ?? 0;
    const sort = resolveSort(
      CONVERSATION_SORT_COLUMNS,
      'c.last_message_at',
      options.sortBy,
      options.sortDir,
    );

    const query = this.conversationRepository
      .createQueryBuilder('c')
      .innerJoin(WaContact, 'contact', 'contact.id = c.contact_id')
      .select([
        'c.id AS id',
        'c.contact_id AS "contactId"',
        'c.started_at AS "startedAt"',
        'c.last_message_at AS "lastMessageAt"',
        'c.message_count AS "messageCount"',
        'c.last_language AS "lastLanguage"',
        // Last four digits only. The full number is never selected here.
        'contact.phone_last4 AS "phoneLast4"',
        'contact.consent_status AS "consentStatus"',
        'contact.blocked_at AS "blockedAt"',
      ])
      .orderBy(sort.column, sort.direction)
      .limit(limit)
      .offset(offset);

    if (options.from) {
      query.andWhere('c.last_message_at >= :from', { from: options.from });
    }
    if (options.to) {
      query.andWhere('c.last_message_at < :to', { to: options.to });
    }
    if (options.language) {
      query.andWhere('c.last_language = :language', {
        language: options.language,
      });
    }

    // Filters that are properties of MESSAGES, applied as an EXISTS rather than a join: a join would
    // multiply a conversation row per matching message and break both the count and the paging.
    if (options.handledBy || options.declinedOnly) {
      query.andWhere(
        new Brackets((qb) => {
          qb.where(
            `EXISTS (SELECT 1 FROM "wa_messages" m
                      WHERE m.conversation_id = c.id
                        AND m.handled_by = :handledBy)`,
            {
              handledBy: options.declinedOnly
                ? WaHandledBy.DECLINED
                : options.handledBy,
            },
          );
        }),
      );
    }
    if (options.search?.trim()) {
      query.andWhere(
        `EXISTS (SELECT 1 FROM "wa_messages" m
                  WHERE m.conversation_id = c.id
                    AND LOWER(m.body) LIKE :term)`,
        { term: `%${options.search.trim().toLowerCase()}%` },
      );
    }

    const [conversations, count] = await Promise.all([
      query.getRawMany(),
      query.getCount(),
    ]);

    return { conversations, count };
  }

  /**
   * The languages that actually appear in the log.
   *
   * Its own endpoint rather than reusing the analytics language breakdown, because that one is gated
   * on the analytics permission and windowed to a date range — an admin with conversation access but
   * not analytics access would get an empty filter, and a language nobody used this month would
   * disappear from the dropdown while its threads were still listed.
   */
  async listLanguages(): Promise<string[]> {
    const rows = await this.conversationRepository
      .createQueryBuilder('c')
      .select('DISTINCT c.last_language', 'language')
      .where('c.last_language IS NOT NULL')
      .orderBy('c.last_language', 'ASC')
      .getRawMany<{ language: string }>();

    return rows.map((row) => row.language).filter(Boolean);
  }

  /** One thread with every message, citations resolved to real passage text. */
  async getConversation(id: string) {
    const conversation = await this.conversationRepository.findOne({
      where: { id },
    });
    if (!conversation) {
      throw new NotFoundException(`Conversation ${id} was not found`);
    }

    const contact = await this.contactRepository.findOne({
      where: { id: conversation.contactId },
      // phone_e164 deliberately not selected — reveal is a separate call.
      select: [
        'id',
        'phoneLast4',
        'consentStatus',
        'locale',
        'blockedAt',
        'messageCount',
      ],
    });

    const messages = await this.messageRepository.find({
      where: { conversationId: id },
      order: { createdAt: 'ASC' },
    });

    return {
      conversation,
      contact,
      messages: messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        body: message.body,
        language: message.language,
        handledBy: message.handledBy,
        citations: message.citations ?? [],
        retrievalMeta: message.retrievalMeta ?? null,
        latencyMs: message.latencyMs,
        status: message.status,
        errorMessage: message.errorMessage,
        createdAt: message.createdAt,
      })),
    };
  }

  /**
   * Resolve one citation to the exact passage that was quoted.
   *
   * Reads through the knowledge-base service rather than the vector index, because the chunk row is
   * the system of record: a document re-chunked since the answer was sent has new vector objects, but
   * the old chunk row (and therefore the text actually quoted) is still there.
   */
  async resolveCitation(chunkId: string) {
    return this.knowledgeBaseService.getChunk(chunkId);
  }

  /**
   * Return one contact's full phone number.
   *
   * Separate from every list and detail read on purpose, and logged, because this is the one call that
   * emits identifiable data about a mental healthcare worker. An admin needs it to follow up on a
   * crisis message or block a specific number; nothing else should hand it out.
   */
  async revealContactPhone(contactId: string) {
    const contact = await this.contactRepository.findOne({
      where: { id: contactId },
      select: ['id', 'phoneE164'],
    });
    if (!contact) {
      throw new NotFoundException(`Contact ${contactId} was not found`);
    }

    this.logger.warn(
      `Phone number revealed for contact ${contactId} by user ${
        ExecutionManager.getUserId() ?? 'unknown'
      }`,
    );
    return { id: contact.id, phoneE164: contact.phoneE164 };
  }

  async setContactBlocked(
    contactId: string,
    blocked: boolean,
    reason?: string,
  ) {
    const contact = await this.contactRepository.findOne({
      where: { id: contactId },
    });
    if (!contact) {
      throw new NotFoundException(`Contact ${contactId} was not found`);
    }

    await this.contactRepository.update(
      { id: contactId },
      {
        blockedAt: blocked ? new Date() : null,
        blockedReason: blocked
          ? (reason ?? 'Blocked by an administrator')
          : null,
      },
    );
    return { id: contactId, blocked };
  }

  /**
   * Right-to-erasure: blank the message bodies and the number, keep the counts.
   *
   * There is no account to delete, so erasure means removing the content while leaving the
   * aggregates that the dashboard is built from — deleting the rows outright would silently rewrite
   * historical usage figures.
   */
  async eraseContact(contactId: string) {
    const contact = await this.contactRepository.findOne({
      where: { id: contactId },
    });
    if (!contact) {
      throw new NotFoundException(`Contact ${contactId} was not found`);
    }

    const conversations = await this.conversationRepository.find({
      where: { contactId },
      select: ['id'],
    });

    await this.messageRepository.update(
      { contactId },
      { body: ERASED, citations: null },
    );
    if (conversations.length) {
      await this.unansweredRepository.update(
        { conversationId: In(conversations.map((c) => c.id)) },
        { questionText: ERASED },
      );
    }
    await this.contactRepository.update(
      { id: contactId },
      {
        // A placeholder rather than null: the column is unique and NOT NULL, and reusing the id keeps
        // the row identifiable for audit without holding the number.
        phoneE164: `${ERASED_PHONE_PREFIX}${contactId}`,
        phoneLast4: '0000',
        locale: null,
      },
    );

    this.logger.warn(
      `Contact ${contactId} erased by user ${ExecutionManager.getUserId() ?? 'unknown'}`,
    );
    return { id: contactId, erased: true };
  }

  // ── unanswered queue ──────────────────────────────────────────────────

  async listUnanswered(options: {
    limit?: number;
    offset?: number;
    status?: WaUnansweredStatus;
    reason?: WaUnansweredReason;
    from?: Date;
    to?: Date;
    sortBy?: string;
    sortDir?: string;
  }) {
    const sort = resolveSort(
      UNANSWERED_SORT_COLUMNS,
      'q.createdAt',
      options.sortBy,
      options.sortDir,
    );

    const query = this.unansweredRepository
      .createQueryBuilder('q')
      .orderBy(sort.column, sort.direction)
      .limit(options.limit ?? 25)
      .offset(options.offset ?? 0);

    // Defaults to OPEN: the queue is a worklist, and showing resolved items by default would bury
    // the ones that still need a decision.
    query.andWhere('q.status = :status', {
      status: options.status ?? WaUnansweredStatus.OPEN,
    });

    if (options.reason) {
      query.andWhere('q.reason = :reason', { reason: options.reason });
    }
    if (options.from) {
      query.andWhere('q.createdAt >= :from', { from: options.from });
    }
    if (options.to) {
      query.andWhere('q.createdAt < :to', { to: options.to });
    }

    const [questions, count] = await query.getManyAndCount();
    return { questions, count };
  }

  async updateUnanswered(
    id: string,
    patch: {
      status?: WaUnansweredStatus;
      assignedTo?: number | null;
      resolutionNote?: string;
      linkedDocumentId?: string;
    },
  ) {
    const row = await this.unansweredRepository.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Question ${id} was not found`);

    const resolving =
      patch.status === WaUnansweredStatus.ANSWERED ||
      patch.status === WaUnansweredStatus.DISMISSED;

    await this.unansweredRepository.update(
      { id },
      {
        ...patch,
        ...(resolving
          ? {
              resolvedBy: Number(ExecutionManager.getUserId() ?? 0),
              resolvedAt: new Date(),
            }
          : {}),
      },
    );
    return this.unansweredRepository.findOne({ where: { id } });
  }

  /**
   * Turn a gap into corpus material in one action.
   *
   * The loop that matters: a worker asked something the corpus could not answer, an admin writes the
   * answer, and the next worker to ask gets it. Doing this as two disconnected steps — create a
   * document over in the corpus tab, then come back and remember to close the queue item — is how
   * queues grow stale while the corpus quietly already covers half of them.
   *
   * The admin supplies the answer text; the question is NOT used as the body. A document whose
   * content is the question would embed well against that question and contain no answer, which is
   * worse than a decline.
   */
  async createDocumentFromUnanswered(
    id: string,
    body: { title: string; text: string; tags?: string[] },
  ) {
    const row = await this.unansweredRepository.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Question ${id} was not found`);

    const document = await this.knowledgeBaseService.create({
      title: body.title.trim(),
      sourceType: KbDocumentSourceType.PASTE,
      text: body.text,
      tags: body.tags ?? [],
      // The question's language, not the answer's: it is a hint for retrieval, and this is the
      // language the gap showed up in.
      language: row.language ?? undefined,
    } as CreateKbDocumentDto);

    // Only marked answered once the document exists. If ingest later fails, the queue item is still
    // resolved but `linkedDocumentId` points at a row whose status says `failed` — visible, rather
    // than a silently unanswered question marked answered.
    await this.unansweredRepository.update(
      { id },
      {
        status: WaUnansweredStatus.ANSWERED,
        linkedDocumentId: document.id,
        resolvedBy: Number(ExecutionManager.getUserId() ?? 0),
        resolvedAt: new Date(),
      },
    );

    return {
      question: await this.unansweredRepository.findOne({ where: { id } }),
      document,
    };
  }

  // ── analytics ─────────────────────────────────────────────────────────

  private window(from?: string, to?: string) {
    // Defaults to the last 30 days. A dashboard with no range is a dashboard nobody can interpret,
    // and an unbounded scan over every message ever is not a sensible default either.
    const end = to ? new Date(to) : new Date();
    const start = from
      ? new Date(from)
      : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { from: start, to: end };
  }

  overview(from?: string, to?: string) {
    return this.analyticsRepository.overview(this.window(from, to));
  }

  timeseries(from?: string, to?: string) {
    return this.analyticsRepository.timeseries(this.window(from, to));
  }

  languages(from?: string, to?: string) {
    return this.analyticsRepository.languages(this.window(from, to));
  }

  /**
   * Citation counts per document, including the documents that were never cited.
   *
   * Three things this has to get right, because the never-cited half is the half an admin acts on:
   *
   * Archived documents are FETCHED but flagged, not dropped. A citation recorded before a document
   * was archived is real history, and building the view only from the active corpus would make those
   * citations vanish — the totals would then quietly fail to reconcile with the message log.
   *
   * A citation whose document no longer exists gets its own row rather than being discarded, so the
   * count on this screen always adds up to the count in `wa_messages`.
   *
   * And the document cap is REPORTED. Silently showing the first N of a larger corpus would present
   * a partial worklist as a complete one, which is worse than showing nothing: an admin would read
   * "nothing else is dead corpus" from a list that simply stopped early.
   */
  async corpusCoverage(from?: string, to?: string) {
    const cited = await this.analyticsRepository.corpusCoverage(
      this.window(from, to),
    );
    const citedById = new Map(
      cited.map((row) => [row.documentId, row.citations]),
    );

    const { documents, count } = await this.knowledgeBaseService.list({
      limit: COVERAGE_DOCUMENT_LIMIT,
      includeArchived: true,
    });

    const rows = documents.map((document) => {
      const citations = citedById.get(document.id) ?? 0;
      // Removed as it is matched, so whatever remains in the map is genuinely orphaned.
      citedById.delete(document.id);
      return {
        documentId: document.id,
        title: document.title,
        chunkCount: document.chunkCount,
        citations,
        isArchived: document.isArchived,
      };
    });

    // Whatever is left in the map was cited but is not in the corpus listing at all — the document
    // was hard-deleted. Named as such rather than dropped, so the totals still reconcile.
    const orphans = Array.from(citedById.entries()).map(
      ([documentId, citations]) => ({
        documentId,
        title: 'Deleted document',
        chunkCount: 0,
        citations,
        isArchived: true,
      }),
    );

    return {
      rows: [...rows, ...orphans].sort((a, b) => b.citations - a.citations),
      totalDocuments: count,
      // Non-zero means this view is a partial picture and says so on screen.
      omittedDocuments: Math.max(0, count - documents.length),
    };
  }
}

/**
 * What a caller may sort the conversation log by.
 *
 * A whitelist, not a pass-through: these strings land in ORDER BY. Deliberately short — sorting a
 * log by anything other than time or size is a question nobody has asked.
 */
const CONVERSATION_SORT_COLUMNS = {
  lastMessageAt: 'c.last_message_at',
  startedAt: 'c.started_at',
  messageCount: 'c.message_count',
};

/**
 * What a caller may sort the unanswered queue by.
 *
 * `topSimilarity` is the one worth having beyond time: sorted descending it surfaces the questions
 * the corpus very nearly answered, which are the cheapest gaps to close.
 */
const UNANSWERED_SORT_COLUMNS = {
  createdAt: 'q.createdAt',
  topSimilarity: 'q.topSimilarity',
  hitCount: 'q.hitCount',
};

/**
 * How many documents the coverage view fetches.
 *
 * A bound rather than an unbounded read, but a reported one: `omittedDocuments` tells the caller when
 * the corpus is larger than this, so a partial worklist is never presented as a complete one.
 */
export const COVERAGE_DOCUMENT_LIMIT = 500;
