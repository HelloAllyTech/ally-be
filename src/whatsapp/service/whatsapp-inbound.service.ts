import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { AiService } from 'src/ai/service/ai.service';
import { KnowledgeAnswerResponse } from 'src/ai/dto/knowledge.dto';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { NotificationErrorType } from 'src/notification/type/notification.error.type';
import { WaContact } from '../entity/wa-contact.entity';
import { WaConversation } from '../entity/wa-conversation.entity';
import { WaMessage } from '../entity/wa-message.entity';
import { WaUnansweredQuestion } from '../entity/wa-unanswered-question.entity';
import {
  WaConsentStatus,
  WaHandledBy,
  WaMessageDirection,
  WaMessageStatus,
  WaTemplateKind,
  WaUnansweredReason,
} from '../enum/whatsapp.enum';
import { InboundWhatsAppMessage } from '../type/whatsapp-provider.interface';
import {
  WHATSAPP_PROVIDER,
  WhatsAppProvider,
} from '../type/whatsapp-provider.interface';
import { WhatsAppBotSettings } from '../type/whatsapp-settings.type';
import { WhatsAppRateLimitService } from './whatsapp-rate-limit.service';
import { WhatsAppSettingsService } from './whatsapp-settings.service';
import { WhatsAppTemplateService } from './whatsapp-template.service';
import { composeReply } from '../util/reply-composer';

/**
 * Opt-out / opt-in words, recognised in code regardless of what templates exist.
 *
 * Hard-coded rather than left to a template because opting out is a compliance obligation, and it
 * must keep working even if an admin deletes or breaks the consent template.
 */
const OPT_OUT_WORDS = new Set(['stop', 'unsubscribe', 'cancel', 'quit']);
const OPT_IN_WORDS = new Set(['start', 'subscribe', 'resume']);

/**
 * The ally-ai prompt codes this feature owns.
 *
 * Derived from the file paths in ally-ai (`knowledge/whatsapp_answer` →
 * `ally_ai_knowledge_whatsapp_answer`), which is the convention its resolver uses.
 */
const KNOWLEDGE_PROMPT_CODES = [
  'ally_ai_knowledge_whatsapp_answer',
  'ally_ai_knowledge_translate_query',
  'ally_ai_knowledge_crisis_classify',
];

/**
 * Processes one inbound WhatsApp message end to end.
 *
 * The ORDER of the steps below is the design. Each one exists because of a specific way the pipeline
 * would otherwise misbehave, and moving any of them breaks that guarantee:
 *
 *   1. dedupe        — first, always. SQS is at-least-once AND Meta retries independently.
 *   2. kill switch   — before anything costs money.
 *   3. contact       — resolves consent and block state.
 *   4. rate limit    — after dedupe, so a redelivery never consumes budget.
 *   5. consent gate  — before the LLM, so a first-time worker sees the disclaimer.
 *   6. templates     — before retrieval, so a crisis reply never depends on a model call.
 *   7. retrieval     — the expensive part, reached only when nothing above handled it, run
 *                      concurrently with the LLM crisis classifier (step 6 is keywords; this is the
 *                      second layer, and it wins over any answer that comes back beside it).
 *   8. send          — persisted as `queued` BEFORE the send, so a crash is visible.
 *
 * THE ONE INVARIANT: this service throws only BEFORE it has sent anything. After a send it records
 * the failure and returns normally. Throwing after a send guarantees an SQS redelivery that answers
 * the same worker twice, which is the worst failure this pipeline has.
 */
@Injectable()
export class WhatsAppInboundService {
  private readonly logger = LoggerService.getInstance(
    WhatsAppInboundService.name,
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
    @Inject(WHATSAPP_PROVIDER)
    private readonly provider: WhatsAppProvider,
    private readonly settingsService: WhatsAppSettingsService,
    private readonly templateService: WhatsAppTemplateService,
    private readonly rateLimitService: WhatsAppRateLimitService,
    private readonly aiService: AiService,
    private readonly promptSharedService: PromptSharedService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async handle(inbound: InboundWhatsAppMessage): Promise<void> {
    const settings = await this.settingsService.get();

    // ── 1. Dedupe ──────────────────────────────────────────────────────────
    // First statement, unconditionally. ON CONFLICT DO NOTHING against the unique index on
    // provider_message_id is the only reliable guard: SQS may redeliver and Meta may retry, and the
    // two are independent, so no in-memory or lock-based scheme covers both.
    const inserted = await this.messageRepository
      .createQueryBuilder()
      .insert()
      .into(WaMessage)
      .values({
        // A placeholder conversation is impossible before we know the contact, so the row is
        // inserted with the ids filled in immediately afterwards. The INSERT exists to claim the
        // provider id, which is the part that must be atomic.
        conversationId: '00000000-0000-0000-0000-000000000000',
        contactId: '00000000-0000-0000-0000-000000000000',
        direction: WaMessageDirection.INBOUND,
        providerMessageId: inbound.providerMessageId,
        body: inbound.text,
        status: WaMessageStatus.RECEIVED,
      })
      .orIgnore()
      .returning('id')
      .execute();

    const inboundId: string | undefined = inserted.raw?.[0]?.id;
    if (!inboundId) {
      this.logger.info(
        `Skipping already-handled message ${inbound.providerMessageId}`,
      );
      return;
    }

    const startedAt = Date.now();

    try {
      // ── 2. Kill switch ───────────────────────────────────────────────────
      if (!settings.enabled) {
        await this.discard(inboundId, 'the bot is disabled');
        return;
      }

      // ── 3. Contact ───────────────────────────────────────────────────────
      const contact = await this.resolveContact(inbound);
      const conversation = await this.resolveConversation(contact, settings);
      await this.messageRepository.update(
        { id: inboundId },
        {
          contactId: contact.id,
          conversationId: conversation.id,
          status: WaMessageStatus.PROCESSING,
        },
      );

      if (contact.blockedAt) {
        // Silently. Telling an abuser precisely when they were blocked mostly teaches them to
        // switch numbers.
        await this.discard(inboundId, 'the contact is blocked');
        return;
      }

      // Media has no text to answer, and this check comes before the rate limit so a worker sending
      // a photo is told why rather than being counted against their budget.
      if (inbound.isUnsupportedMedia || !inbound.text.trim()) {
        await this.reply(
          contact,
          conversation,
          inboundId,
          settings.unsupportedMediaText,
          WaHandledBy.UNSUPPORTED_MEDIA,
          startedAt,
        );
        return;
      }

      // ── 4. Rate limit ────────────────────────────────────────────────────
      const limit = await this.rateLimitService.check(
        contact.phoneE164,
        settings,
      );
      if (!limit.allowed) {
        const notify = await this.rateLimitService.shouldNotify(
          contact.phoneE164,
          limit.window ?? 'minute',
        );
        if (notify) {
          await this.reply(
            contact,
            conversation,
            inboundId,
            settings.rateLimitText,
            WaHandledBy.RATE_LIMITED,
            startedAt,
          );
        } else {
          await this.discard(inboundId, 'rate limited (already notified)');
        }
        return;
      }

      // ── 5. Consent / opt-out ─────────────────────────────────────────────
      const consentHandled = await this.handleConsent(
        contact,
        conversation,
        inboundId,
        inbound.text,
        settings,
        startedAt,
      );
      if (consentHandled) return;

      // ── 6. Templates ─────────────────────────────────────────────────────
      const match = await this.templateService.match(
        inbound.text,
        contact.locale,
      );
      if (match && match.bypassRag) {
        const isCrisis = match.template.kind === WaTemplateKind.CRISIS;
        const body = this.settingsService.renderPlaceholders(
          isCrisis
            ? match.template.responseText || settings.crisisEscalationText
            : match.template.responseText,
          settings,
        );

        await this.reply(
          contact,
          conversation,
          inboundId,
          body,
          isCrisis ? WaHandledBy.CRISIS : WaHandledBy.TEMPLATE,
          startedAt,
          { templateId: match.template.id },
        );

        if (isCrisis) {
          // Routed to the existing Slack exception path so a human learns about it in near real
          // time. A crisis reply that only lands in a database table nobody is watching is a log
          // entry, not an escalation.
          this.eventEmitter.emit('exception', {
            statusCode: 200,
            timestamp: new Date().toISOString(),
            path: 'whatsapp/crisis',
            message:
              `A crisis keyword matched on the WhatsApp bot (contact ends ` +
              `${contact.phoneLast4}). The fixed safety reply was sent.`,
            type: 'WhatsApp Crisis Keyword',
          } as NotificationErrorType);
        }
        return;
      }

      // ── 7. Retrieval + answer ────────────────────────────────────────────
      await this.answerFromCorpus(
        contact,
        conversation,
        inboundId,
        inbound.text,
        settings,
        startedAt,
      );
    } catch (error) {
      // Reached only when nothing has been sent — every send path above returns. Recorded on the
      // message and swallowed: rethrowing would redeliver and risk a second reply.
      const message =
        error instanceof Error ? error.message : 'unknown failure';
      this.logger.error(`WhatsApp inbound processing failed: ${message}`);
      await this.messageRepository.update(
        { id: inboundId },
        { status: WaMessageStatus.FAILED, errorMessage: message },
      );
    }
  }

  // ─────────────────────────────────────────────────────────────── consent

  /**
   * Handle STOP / START and the first-contact disclaimer.
   *
   * Returns true when this step produced the reply.
   *
   * The disclaimer is PREFIXED onto the answer to the worker's real question rather than sent as a
   * standalone message. A bare disclaimer reads as a bot that ignored you, and it costs the worker a
   * round trip to ask again.
   */
  private async handleConsent(
    contact: WaContact,
    conversation: WaConversation,
    inboundId: string,
    text: string,
    settings: WhatsAppBotSettings,
    startedAt: number,
  ): Promise<boolean> {
    const normalised = WhatsAppTemplateService.normalise(text);

    if (OPT_OUT_WORDS.has(normalised)) {
      await this.contactRepository.update(
        { id: contact.id },
        {
          consentStatus: WaConsentStatus.OPTED_OUT,
          optedOutAt: new Date(),
        },
      );
      const template = (
        await this.templateService.findByKind(WaTemplateKind.CONSENT)
      ).find((t) => t.patterns.some((p) => OPT_OUT_WORDS.has(p.toLowerCase())));
      await this.reply(
        contact,
        conversation,
        inboundId,
        this.settingsService.renderPlaceholders(
          template?.responseText ??
            'You will not receive any more messages. Reply START at any time to opt back in.',
          settings,
        ),
        WaHandledBy.CONSENT,
        startedAt,
        { templateId: template?.id },
      );
      return true;
    }

    if (contact.consentStatus === WaConsentStatus.OPTED_OUT) {
      if (OPT_IN_WORDS.has(normalised)) {
        await this.contactRepository.update(
          { id: contact.id },
          {
            consentStatus: WaConsentStatus.GRANTED,
            consentGrantedAt: new Date(),
            optedOutAt: null,
          },
        );
        await this.reply(
          contact,
          conversation,
          inboundId,
          this.settingsService.renderPlaceholders(
            settings.disclaimerText,
            settings,
          ),
          WaHandledBy.CONSENT,
          startedAt,
        );
        return true;
      }
      // Anything else from an opted-out number is dropped in silence. Replying at all — even
      // "you have opted out" — is a message they explicitly asked not to receive.
      await this.discard(inboundId, 'the contact has opted out');
      return true;
    }

    return false;
  }

  // ────────────────────────────────────────────────────────────── retrieval

  private async answerFromCorpus(
    contact: WaContact,
    conversation: WaConversation,
    inboundId: string,
    question: string,
    settings: WhatsAppBotSettings,
    startedAt: number,
  ): Promise<void> {
    const history = await this.recentHistory(conversation.id);
    const prompts = await this.loadPromptOverrides();

    // The answer and the crisis classifier run CONCURRENTLY, not in sequence.
    //
    // Sequentially, the safety net would add a second LLM round trip to the latency of every
    // ordinary reference question — which is nearly all of them — and the pair still has to finish
    // inside one SQS visibility window. Run together it costs a small-model call and no waiting.
    //
    // `allSettled`, not `all`: a rejected classifier must not take down an answer that arrived fine.
    // The classifier's own failure path already returns `failed` rather than throwing, so a rejection
    // here means something below it broke — and the keyword rules, which ran before this, are what
    // still hold.
    const [answerResult, crisisResult] = await Promise.allSettled([
      this.aiService.answerKnowledgeQuestion({
        question,
        history,
        prompts,
        top_k: settings.retrieval.topK,
        min_similarity: settings.retrieval.minSimilarity,
        decline_similarity: settings.retrieval.declineSimilarity,
        max_passages: settings.retrieval.maxPassages,
        max_context_tokens: settings.retrieval.maxContextTokens,
        similarity_band: settings.retrieval.similarityBand,
        max_answer_chars: settings.maxAnswerChars,
        translate_query: settings.retrieval.translateQuery,
      }),
      settings.crisisClassifierEnabled
        ? this.aiService.checkWhatsAppCrisis({ message: question, prompts })
        : Promise.resolve(null),
    ]);

    // Crisis wins over the answer, unconditionally and before anything is sent. Not gated on the
    // model's confidence: the prompt tells it to choose crisis when uncertain, so re-gating on
    // confidence here would quietly undo that instruction. The cost of a false positive is one
    // worker rephrasing one question; the cost of a false negative is answering a reference
    // question at someone in danger.
    const crisis =
      crisisResult.status === 'fulfilled' ? crisisResult.value : null;
    if (crisis?.is_crisis) {
      await this.reply(
        contact,
        conversation,
        inboundId,
        this.settingsService.renderPlaceholders(
          settings.crisisEscalationText,
          settings,
        ),
        WaHandledBy.CRISIS,
        startedAt,
      );

      this.eventEmitter.emit('exception', {
        statusCode: 200,
        timestamp: new Date().toISOString(),
        path: 'whatsapp/crisis',
        message:
          `The crisis classifier fired on the WhatsApp bot (contact ends ` +
          `${contact.phoneLast4}, confidence ${crisis.confidence.toFixed(2)}, signal ` +
          `"${crisis.signal}"). The fixed safety reply was sent and the corpus answer was ` +
          `discarded. No keyword matched, so this one would have been answered as an ` +
          `ordinary question.`,
        type: 'WhatsApp Crisis Classifier',
      } as NotificationErrorType);
      return;
    }

    if (crisis?.failed) {
      // Named explicitly, because a silently degraded safety net is worse than a loud one: from the
      // dashboard, "the classifier never fires" and "the classifier is down" look identical.
      this.logger.warn(
        'Crisis classifier did not run for this message; keyword rules only',
      );
    }

    let answer: KnowledgeAnswerResponse;
    if (answerResult.status === 'fulfilled') {
      answer = answerResult.value;
    } else {
      const error = answerResult.reason;
      // A model or index outage is NOT "the corpus does not cover this". It gets the fallback
      // wording and an ERROR-reason queue row, so a bad afternoon for ally-ai does not silently fill
      // the unanswered queue with questions the corpus answers perfectly well.
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`Knowledge agent call failed: ${reason}`);
      await this.reply(
        contact,
        conversation,
        inboundId,
        settings.fallbackText,
        WaHandledBy.ERROR,
        startedAt,
      );
      await this.recordUnanswered(
        inboundId,
        conversation.id,
        question,
        contact.locale,
        WaUnansweredReason.ERROR,
        null,
        0,
      );
      return;
    }

    if (answer.language) {
      await this.contactRepository.update(
        { id: contact.id },
        { locale: answer.language },
      );
      await this.conversationRepository.update(
        { id: conversation.id },
        { lastLanguage: answer.language },
      );
    }

    const composed = composeReply({
      intent: answer.intent,
      answer: answer.answer,
      declineText: settings.declineText,
      citations: answer.citations,
      maxAnswerChars: settings.maxAnswerChars,
      maxReplyChars: settings.maxReplyChars,
      maxCitations: settings.maxCitations,
    });

    const handledBy =
      answer.intent === 'answer'
        ? WaHandledBy.RAG
        : answer.intent === 'clarify'
          ? WaHandledBy.CLARIFIED
          : WaHandledBy.DECLINED;

    await this.reply(
      contact,
      conversation,
      inboundId,
      composed,
      handledBy,
      startedAt,
      {
        citations: answer.citations as unknown as Record<string, any>[],
        retrievalMeta: {
          ...answer.retrieval,
          // The provider and model that ACTUALLY ran, which is not necessarily the configured one:
          // dispatch falls back when a key is missing. Without these, "why did this answer change?"
          // is unanswerable, because prompt_version does not move when an admin swaps models.
          provider: answer.provider,
          model: answer.model,
          prompt_version: answer.prompt_version,
        },
        language: answer.language,
      },
    );

    // A CLARIFY is deliberately NOT filed. A question too vague to retrieve against is not evidence
    // of a corpus gap, and letting those in buries the real gaps.
    if (answer.intent === 'decline') {
      await this.recordUnanswered(
        inboundId,
        conversation.id,
        question,
        answer.language,
        this.mapDeclineReason(answer.decline_reason),
        answer.retrieval?.top_similarity ?? null,
        answer.retrieval?.hit_count ?? 0,
      );
    }
  }

  private mapDeclineReason(reason: string): WaUnansweredReason {
    switch (reason) {
      case 'no_hits':
        return WaUnansweredReason.NO_HITS;
      case 'below_threshold':
        return WaUnansweredReason.BELOW_THRESHOLD;
      case 'model_declined':
        return WaUnansweredReason.MODEL_DECLINED;
      default:
        return WaUnansweredReason.ERROR;
    }
  }

  /**
   * Prompt overrides for the two knowledge prompts, carrying the admin-selected model.
   *
   * Scoped by prompt-code prefix so this sends only the knowledge prompts, not every ally-ai prompt
   * in the database — the payload rides on every single question.
   *
   * `useDashboardOverrideOnly` is deliberately NOT set, unlike the scenario-session loader. There the
   * flag means "only send prompts an admin has explicitly taken over"; here the model and temperature
   * are the point, and an admin who picks Claude without rewriting the prompt text must still have
   * that choice reach ally-ai. Rows with empty text are dropped below so ally-ai falls back to its
   * own file default for the wording while still honouring the selected model.
   */
  private async loadPromptOverrides(): Promise<Record<string, unknown>> {
    try {
      const rows = await this.promptSharedService.getPromptsByOptions({
        promptCode: KNOWLEDGE_PROMPT_CODES,
      });

      return (rows ?? []).reduce<Record<string, unknown>>((acc, row) => {
        const entry: Record<string, unknown> = {};
        const content = row.prompt?.trim();
        if (content) entry.prompt = content;
        if (row.provider) entry.provider = row.provider;
        if (row.model) entry.model = row.model;
        if (typeof row.temperature === 'number') {
          entry.temperature = row.temperature;
        }
        if (row.availableVariables) {
          entry.availableVariables = row.availableVariables;
        }
        // An entry with nothing in it would override nothing but still ship a key; skip it.
        if (Object.keys(entry).length) acc[row.promptCode] = entry;
        return acc;
      }, {});
    } catch (error) {
      // Falls back to ally-ai's own file defaults, which are sane. Not worth failing a worker's
      // question over.
      this.logger.warn(
        `Could not load prompt overrides; ally-ai defaults will be used: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return {};
    }
  }

  private async recentHistory(
    conversationId: string,
  ): Promise<{ role: string; content: string }[]> {
    const rows = await this.messageRepository.find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      take: 6,
      select: ['direction', 'body', 'createdAt'],
    });
    return rows
      .reverse()
      .map((row) => ({
        role:
          row.direction === WaMessageDirection.INBOUND ? 'user' : 'assistant',
        content: row.body,
      }))
      .filter((turn) => turn.content?.trim());
  }

  // ─────────────────────────────────────────────────────────────── plumbing

  private async resolveContact(
    inbound: InboundWhatsAppMessage,
  ): Promise<WaContact> {
    const now = new Date();
    const existing = await this.contactRepository.findOne({
      where: { phoneE164: inbound.from },
    });
    if (existing) {
      await this.contactRepository.update(
        { id: existing.id },
        { lastSeenAt: now, messageCount: existing.messageCount + 1 },
      );
      return { ...existing, messageCount: existing.messageCount + 1 };
    }

    return this.contactRepository.save(
      this.contactRepository.create({
        phoneE164: inbound.from,
        phoneLast4: inbound.from.slice(-4),
        consentStatus: WaConsentStatus.PENDING,
        firstSeenAt: now,
        lastSeenAt: now,
        messageCount: 1,
      }),
    );
  }

  /**
   * Find the open thread or start a new one.
   *
   * WhatsApp has no session concept, so one is defined: `conversationIdleMinutes` of silence closes
   * the thread. Without it the RAG agent would eventually be handed a month-old exchange as context
   * for today's question, which is worse than no context.
   */
  private async resolveConversation(
    contact: WaContact,
    settings: WhatsAppBotSettings,
  ): Promise<WaConversation> {
    const now = new Date();
    const cutoff = new Date(
      now.getTime() - settings.conversationIdleMinutes * 60_000,
    );

    const open = await this.conversationRepository
      .createQueryBuilder('c')
      .where('c.contactId = :contactId', { contactId: contact.id })
      .andWhere('c.lastMessageAt >= :cutoff', { cutoff })
      .orderBy('c.lastMessageAt', 'DESC')
      .getOne();

    if (open) {
      await this.conversationRepository.update(
        { id: open.id },
        { lastMessageAt: now, messageCount: open.messageCount + 1 },
      );
      return open;
    }

    return this.conversationRepository.save(
      this.conversationRepository.create({
        contactId: contact.id,
        startedAt: now,
        lastMessageAt: now,
        messageCount: 1,
      }),
    );
  }

  /**
   * Persist the outbound row, then send, then record the result.
   *
   * Persisted as `queued` BEFORE the send so a crash between the two is visible as a queued message
   * that never went out, rather than invisible. A send failure is recorded and swallowed — see the
   * class invariant.
   */
  private async reply(
    contact: WaContact,
    conversation: WaConversation,
    inReplyToId: string,
    body: string,
    handledBy: WaHandledBy,
    startedAt: number,
    extra: {
      templateId?: string;
      citations?: Record<string, any>[];
      retrievalMeta?: Record<string, any>;
      language?: string;
    } = {},
  ): Promise<void> {
    const outbound = await this.messageRepository.save(
      this.messageRepository.create({
        conversationId: conversation.id,
        contactId: contact.id,
        direction: WaMessageDirection.OUTBOUND,
        body,
        handledBy,
        templateId: extra.templateId ?? null,
        citations: extra.citations ?? null,
        retrievalMeta: extra.retrievalMeta ?? null,
        language: extra.language ?? null,
        latencyMs: Date.now() - startedAt,
        status: WaMessageStatus.QUEUED,
        inReplyToId,
      }),
    );

    try {
      const { providerMessageId } = await this.provider.sendText(
        contact.phoneE164,
        body,
      );
      await this.messageRepository.update(
        { id: outbound.id },
        { providerMessageId, status: WaMessageStatus.SENT },
      );
      await this.messageRepository.update(
        { id: inReplyToId },
        { status: WaMessageStatus.SENT, handledBy },
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`WhatsApp send failed: ${reason}`);
      await this.messageRepository.update(
        { id: outbound.id },
        { status: WaMessageStatus.FAILED, errorMessage: reason },
      );
      await this.messageRepository.update(
        { id: inReplyToId },
        { status: WaMessageStatus.FAILED, errorMessage: reason, handledBy },
      );
    }

    // Record consent on the first successful exchange, not before: a disclaimer that failed to send
    // has not been shown, and marking it granted would mean the worker never sees it.
    if (contact.consentStatus === WaConsentStatus.PENDING) {
      await this.contactRepository.update(
        { id: contact.id },
        {
          consentStatus: WaConsentStatus.GRANTED,
          consentGrantedAt: new Date(),
        },
      );
    }
  }

  private async discard(messageId: string, reason: string): Promise<void> {
    this.logger.info(`Discarding inbound message: ${reason}`);
    await this.messageRepository.update(
      { id: messageId },
      { status: WaMessageStatus.DISCARDED, errorMessage: reason },
    );
  }

  private async recordUnanswered(
    messageId: string,
    conversationId: string,
    question: string,
    language: string | null | undefined,
    reason: WaUnansweredReason,
    topSimilarity: number | null,
    hitCount: number,
  ): Promise<void> {
    try {
      await this.unansweredRepository
        .createQueryBuilder()
        .insert()
        .into(WaUnansweredQuestion)
        .values({
          messageId,
          conversationId,
          questionText: question,
          language: language ?? null,
          reason,
          topSimilarity:
            topSimilarity === null ? null : String(topSimilarity.toFixed(4)),
          hitCount,
        })
        // Unique on message_id: a redelivery must not double-file the same gap.
        .orIgnore()
        .execute();
    } catch (error) {
      // Never fail a reply that already went out over a bookkeeping row.
      this.logger.error(
        `Could not record an unanswered question: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
