import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AiService } from 'src/ai/service/ai.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import { WaKeywordTemplate } from '../entity/wa-keyword-template.entity';
import { WaTemplateKind } from '../enum/whatsapp.enum';
import {
  CreateWaTemplateDto,
  PreviewAskDto,
  ReorderWaTemplatesDto,
  TestWaTemplateDto,
  UpdateWaTemplateDto,
} from '../dto/whatsapp.dto';
import { WhatsAppSettingsService } from './whatsapp-settings.service';
import { WhatsAppTemplateService } from './whatsapp-template.service';
import { composeReply } from '../util/reply-composer';

@Injectable()
export class WhatsAppAdminService {
  private readonly logger = LoggerService.getInstance(
    WhatsAppAdminService.name,
  );

  constructor(
    @InjectRepository(WaKeywordTemplate)
    private readonly templateRepository: Repository<WaKeywordTemplate>,
    private readonly templateService: WhatsAppTemplateService,
    private readonly settingsService: WhatsAppSettingsService,
    private readonly aiService: AiService,
  ) {}

  private userId(): number {
    return Number(ExecutionManager.getUserId() ?? 0);
  }

  // ── templates ─────────────────────────────────────────────────────────

  async listTemplates(kind?: WaTemplateKind, includeArchived = false) {
    const templates = await this.templateRepository.find({
      where: {
        ...(kind ? { kind } : {}),
        ...(includeArchived ? {} : { archivedAt: IsNull() }),
      },
      // Same order the matcher uses, so what an admin sees IS the evaluation order.
      order: { priority: 'ASC', createdAt: 'ASC' },
    });
    return { templates, count: templates.length };
  }

  async createTemplate(dto: CreateWaTemplateDto) {
    this.validatePatterns(dto.matchType, dto.patterns);

    return this.templateRepository.save(
      this.templateRepository.create({
        ...dto,
        bypassRag: dto.bypassRag ?? true,
        terminal: dto.terminal ?? dto.kind === WaTemplateKind.CRISIS,
        active: dto.active ?? true,
        // Only a migration seeds a mandatory rule. An admin-created one can always be removed.
        mandatory: false,
        createdBy: this.userId(),
      }),
    );
  }

  async updateTemplate(id: string, dto: UpdateWaTemplateDto) {
    const template = await this.findTemplateOrFail(id);

    if (dto.matchType || dto.patterns) {
      this.validatePatterns(
        dto.matchType ?? template.matchType,
        dto.patterns ?? template.patterns,
      );
    }

    // A mandatory rule's WORDING is editable — a helpline number changes, the tone needs work — but
    // it cannot be switched off. A bot for this audience with its crisis reply deactivated is not a
    // degraded bot, it is an unsafe one.
    if (template.mandatory && dto.active === false) {
      throw new ForbiddenException(
        `"${template.name}" is a required safety template and cannot be deactivated. You can edit ` +
          `its wording instead.`,
      );
    }

    await this.templateRepository.update(
      { id },
      { ...dto, updatedBy: this.userId() },
    );
    return this.findTemplateOrFail(id);
  }

  async archiveTemplate(id: string) {
    const template = await this.findTemplateOrFail(id);
    if (template.mandatory) {
      throw new ForbiddenException(
        `"${template.name}" is a required safety template and cannot be removed.`,
      );
    }
    await this.templateRepository.update(
      { id },
      { archivedAt: new Date(), updatedBy: this.userId() },
    );
    return this.findTemplateOrFail(id);
  }

  /**
   * Rewrite priorities from an ordered id list.
   *
   * Renumbered in steps of 10 within each kind's band rather than 0..n, so a later insert has room
   * between two rules without another full reorder — and so a reorder can never move an FAQ rule
   * above a crisis rule, because each id keeps its own kind's band.
   */
  async reorderTemplates(dto: ReorderWaTemplatesDto) {
    const templates = await this.templateRepository.find({
      where: { archivedAt: IsNull() },
    });
    const byId = new Map(templates.map((t) => [t.id, t]));

    const bandStart: Record<string, number> = {
      [WaTemplateKind.CRISIS]: 0,
      [WaTemplateKind.CONSENT]: 100,
      [WaTemplateKind.COMMAND]: 200,
      [WaTemplateKind.FAQ]: 300,
    };
    const nextInBand: Record<string, number> = { ...bandStart };

    for (const id of dto.ids) {
      const template = byId.get(id);
      if (!template) continue;
      const priority = (nextInBand[template.kind] ?? 300) + 10;
      nextInBand[template.kind] = priority;
      await this.templateRepository.update({ id }, { priority });
    }

    return this.listTemplates();
  }

  /**
   * Which rule a given message would match — without sending anything.
   *
   * The point of this endpoint is that template ordering is safety-critical and invisible: an admin
   * cannot otherwise tell that their new FAQ rule now swallows a phrase the crisis rule used to
   * catch.
   */
  async testTemplate(dto: TestWaTemplateDto) {
    const settings = await this.settingsService.get();
    const match = await this.templateService.match(dto.text, dto.language);

    if (!match) {
      return {
        matched: false,
        normalisedText: WhatsAppTemplateService.normalise(dto.text),
        wouldReachRetrieval: true,
      };
    }

    return {
      matched: true,
      normalisedText: WhatsAppTemplateService.normalise(dto.text),
      template: {
        id: match.template.id,
        name: match.template.name,
        kind: match.template.kind,
        priority: match.template.priority,
      },
      reply: this.settingsService.renderPlaceholders(
        match.template.responseText,
        settings,
      ),
      terminal: match.terminal,
      wouldReachRetrieval: !match.bypassRag,
    };
  }

  private validatePatterns(matchType: string, patterns: string[]): void {
    const cleaned = (patterns ?? []).filter((p) => p?.trim());
    if (!cleaned.length) {
      throw new BadRequestException('A template needs at least one pattern.');
    }
    if (matchType === 'regex') {
      for (const source of cleaned) {
        try {
          new RegExp(source, 'iu');
        } catch (error) {
          // Validated on save rather than discovered at match time: an invalid regex saved here is
          // skipped silently by the matcher, so the rule would look active and never fire.
          throw new BadRequestException(
            `"${source}" is not a valid regular expression: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
        }
      }
    }
  }

  private async findTemplateOrFail(id: string): Promise<WaKeywordTemplate> {
    const template = await this.templateRepository.findOne({ where: { id } });
    if (!template) throw new NotFoundException(`Template ${id} was not found`);
    return template;
  }

  // ── settings ──────────────────────────────────────────────────────────

  getSettings() {
    return this.settingsService.get();
  }

  updateSettings(patch: Record<string, unknown>) {
    return this.settingsService.update(patch);
  }

  /**
   * Whether the provider is configured, without revealing any secret.
   *
   * Booleans only — never the values. An admin needs to know "is the app secret set", and returning
   * the secret to answer that would put it in a browser and in any screenshot of this screen.
   */
  async providerHealth() {
    const settings = await this.settingsService.get();
    return {
      enabled: settings.enabled,
      provider: settings.provider,
      verifyTokenConfigured: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
      appSecretConfigured: Boolean(process.env.WHATSAPP_APP_SECRET),
      phoneNumberIdConfigured: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
      accessTokenConfigured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
      inboundQueueConfigured: Boolean(
        process.env.SQS_WHATSAPP_INBOUND_QUEUE_URL,
      ),
    };
  }

  // ── preview console ───────────────────────────────────────────────────

  /**
   * Run a question through retrieval and answering, and return what WOULD be sent.
   *
   * Sends nothing and writes no message rows: this is a tuning tool, and letting it record
   * conversations would pollute the log and the unanswered queue with the admin's own experiments.
   *
   * It is what makes prompt, threshold and corpus changes verifiable without a phone — the
   * difference between tuning and guessing.
   */
  async previewAsk(dto: PreviewAskDto) {
    const settings = await this.settingsService.get();
    const retrieval = { ...settings.retrieval, ...(dto.retrieval ?? {}) };
    const startedAt = Date.now();

    const answer = await this.aiService.answerKnowledgeQuestion({
      question: dto.question,
      history: [],
      top_k: retrieval.topK,
      min_similarity: retrieval.minSimilarity,
      decline_similarity: retrieval.declineSimilarity,
      max_passages: retrieval.maxPassages,
      max_context_tokens: retrieval.maxContextTokens,
      similarity_band: retrieval.similarityBand,
      max_answer_chars: settings.maxAnswerChars,
      translate_query: retrieval.translateQuery,
    });

    const composed = composeReply({
      intent: answer.intent,
      answer: answer.answer,
      declineText: settings.declineText,
      citations: answer.citations,
      maxAnswerChars: settings.maxAnswerChars,
      maxReplyChars: settings.maxReplyChars,
      maxCitations: settings.maxCitations,
    });

    return {
      intent: answer.intent,
      declineReason: answer.decline_reason,
      // The exact text a worker would receive, including source lines and truncation, so an admin
      // sees the real thing rather than the model's raw output.
      reply: composed,
      replyLength: composed.length,
      language: answer.language,
      citations: answer.citations,
      retrieval: answer.retrieval,
      provider: answer.provider,
      model: answer.model,
      promptVersion: answer.prompt_version,
      latencyMs: Date.now() - startedAt,
    };
  }
}
