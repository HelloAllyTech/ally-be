import { randomUUID } from 'crypto';
import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { LoggerService } from 'src/logger/logger.service';
import { RoadmapOpportunityRepository } from 'src/product-roadmap/repository/roadmap-opportunity.repository';
import { RoadmapProductGoalRepository } from 'src/product-roadmap/repository/roadmap-taxonomy.repository';
import { RoadmapOpportunityService } from 'src/product-roadmap/service/roadmap-opportunity.service';
import { RoadmapOpportunityType } from 'src/product-roadmap/enum/roadmap-opportunity.enum';

import { AnalyticsSuggestion } from '../entity/analytics-suggestion.entity';
import { AnalyticsSuggestionRepository } from '../repository/analytics-suggestion.repository';
import {
  AnalyticsSuggestionStatus,
  AnalyticsSuggestionStatusFilter,
} from '../enum/analytics-suggestion.enum';
import {
  MAX_SUGGESTIONS_PER_RUN,
  SUGGESTION_CONTEXT_LIMITS,
  SUGGESTION_FIELD_LIMITS,
} from '../constants/analytics-suggestions.constants';
import {
  AcceptSuggestionDto,
  AcceptSuggestionResponseDto,
  GenerateSuggestionsDto,
  GenerateSuggestionsResponseDto,
  ListSuggestionsResponseDto,
  RejectSuggestionDto,
  SuggestionDto,
} from '../dto/analytics-suggestion.dto';
import {
  AnalyticsSuggestionsAiService,
  RawSuggestion,
} from './analytics-suggestions-ai.service';
import {
  AnalyticsSuggestionsPayloadService,
  SuggestionWindow,
} from './analytics-suggestions-payload.service';

/**
 * The Suggestions review queue: generate, list, accept, reject.
 *
 * The generation half is a pipeline with one rule — nothing the model says is
 * stored without being checked against something real. Goal names are validated
 * against the live taxonomy (an unvalidated model answer once polluted ~54% of
 * the roadmap's goal data; see RoadmapAiService.classifyGoal), types are coerced
 * to the enum, and every text field is capped at the length the roadmap will
 * accept, so a suggestion can never be un-fileable at the last step.
 *
 * The decision half is deliberately not symmetric with it: accepting writes to
 * another module's table, and that path is documented on {@link accept}.
 */
@Injectable()
export class AnalyticsSuggestionsService {
  private readonly logger = LoggerService.getInstance(
    AnalyticsSuggestionsService.name,
  );

  constructor(
    private readonly suggestionRepository: AnalyticsSuggestionRepository,
    private readonly payloadService: AnalyticsSuggestionsPayloadService,
    private readonly aiService: AnalyticsSuggestionsAiService,
    private readonly goalRepository: RoadmapProductGoalRepository,
    private readonly opportunityRepository: RoadmapOpportunityRepository,
    private readonly opportunityService: RoadmapOpportunityService,
  ) {}

  /**
   * Read one analytics window, ask the model what to build, store what survives
   * validation.
   *
   * Either the whole run is stored or none of it is. There is no partial-save
   * path: a suggestion is only interpretable next to the batch it was reasoned
   * alongside, and half a batch would present the model's second-best ideas as
   * its whole answer.
   */
  async generate(
    userId: number,
    dto: GenerateSuggestionsDto,
  ): Promise<GenerateSuggestionsResponseDto> {
    const payload = await this.payloadService.collect(dto);
    const goals = await this.goalRepository.findAllOrdered();
    const goalNames = goals.map((g) => g.name);

    const userMessage = await this.buildUserMessage(payload, goalNames);
    const raw = await this.aiService.generate(userMessage);

    if (raw === null) {
      // Nothing is persisted. An empty list already means "the data supported
      // nothing", so it must not double as "the call went wrong" — a reader who
      // cannot tell those apart will read a broken pipeline as a healthy product.
      throw new BadGatewayException(
        'The model returned output that could not be read as suggestions. ' +
          'Nothing was saved — try generating again.',
      );
    }

    const batchId = randomUUID();
    const model = this.aiService.model;
    const rows = this.normalise(raw, goalNames).map((s) =>
      this.suggestionRepository.create({
        ...s,
        batchId,
        model,
        windowRange: payload.window.range,
        windowFrom: payload.window.from,
        windowTo: payload.window.to,
        windowLabel: payload.window.label,
        createdBy: userId,
        updatedBy: userId,
        status: AnalyticsSuggestionStatus.PENDING,
      }),
    );

    const saved = rows.length ? await this.suggestionRepository.save(rows) : [];

    this.logger.info(
      `[SUGGESTIONS] Run ${batchId} over ${payload.window.label} ` +
        `(${payload.included.length} sections read, ${payload.failed.length} unavailable) ` +
        `produced ${saved.length} suggestion(s).`,
    );

    return {
      batchId,
      window: payload.window,
      model,
      suggestions: saved.map(toSuggestionDto),
      sections: { included: payload.included, failed: payload.failed },
    };
  }

  async list(
    status: AnalyticsSuggestionStatusFilter,
  ): Promise<ListSuggestionsResponseDto> {
    const items = await this.suggestionRepository.listByStatus(status);
    return { items: items.map(toSuggestionDto), count: items.length };
  }

  /**
   * File an accepted suggestion as a roadmap opportunity.
   *
   * Claim-then-file with compensation, NOT one database transaction — and that is
   * a deliberate trade, not an oversight. `RoadmapOpportunityService.create` is
   * the single path by which an opportunity comes into existence: it commits the
   * row, then indexes it for duplicate detection and emits to open boards. Those
   * side effects happen after its own commit and cannot be rolled back, so
   * wrapping it in an outer transaction would buy atomicity for the status column
   * while leaving a vector and a realtime event pointing at a row that no longer
   * exists. Writing the opportunity row directly instead would give real
   * atomicity but skip both side effects, which is how an opportunity ends up
   * invisible to duplicate detection and absent from a board someone is watching.
   *
   * So: validate first (the common failure needs no compensation), claim the row
   * atomically (two reviewers in two tabs cannot both file it), then file. If
   * filing throws, the claim is reverted and the card returns to the queue. The
   * residual window is a crash between filing and linking, which leaves the
   * suggestion accepted with a null opportunityId — visible on the card, and
   * fixable by hand.
   */
  async accept(
    userId: number,
    id: string,
    dto: AcceptSuggestionDto,
  ): Promise<AcceptSuggestionResponseDto> {
    const existing = await this.suggestionRepository.findOne({ where: { id } });
    if (!existing) throw new NotFoundException(`Suggestion ${id} not found`);
    if (existing.status !== AnalyticsSuggestionStatus.PENDING) {
      throw new ConflictException(
        `This suggestion has already been ${existing.status}.`,
      );
    }

    // Checked before claiming: a goal renamed or retired while the suggestion sat
    // in the queue is the likeliest failure here, and it should cost the reviewer
    // a corrected dropdown rather than a card that flickers out of the queue and
    // back.
    const goal = await this.goalRepository.findOne({
      where: { name: dto.productGoal },
    });
    if (!goal) {
      throw new UnprocessableEntityException(
        `"${dto.productGoal}" is not a live product goal. Pick one from the list.`,
      );
    }

    const claimed = await this.suggestionRepository.claimFromPending(id, {
      status: AnalyticsSuggestionStatus.ACCEPTED,
      updatedBy: userId,
    });
    if (!claimed) {
      throw new ConflictException(
        'This suggestion was just decided somewhere else. Reload the list.',
      );
    }

    try {
      const opportunity = await this.opportunityService.create(userId, {
        description: dto.description,
        type: dto.type ?? existing.suggestedType,
        productGoal: goal.name,
      });

      await this.suggestionRepository.update(id, {
        opportunityId: opportunity.id,
        updatedBy: userId,
      });

      const updated = await this.suggestionRepository.findOne({
        where: { id },
      });
      return {
        suggestion: toSuggestionDto(updated ?? existing),
        opportunity: opportunity as unknown as Record<string, unknown>,
      };
    } catch (error) {
      await this.suggestionRepository.revertClaim(
        id,
        AnalyticsSuggestionStatus.ACCEPTED,
      );
      this.logger.error(
        `[SUGGESTIONS] Filing suggestion ${id} failed; returned it to the queue. ` +
          `${(error as Error)?.message}`,
      );
      throw error;
    }
  }

  /**
   * Record a "no", with an optional reason.
   *
   * The reason is what stops the same idea coming back every run — see the
   * "already rejected" block in {@link buildUserMessage}. A rejection without one
   * still suppresses this exact suggestion, but says nothing about the class of
   * suggestion to avoid.
   */
  async reject(
    userId: number,
    id: string,
    dto: RejectSuggestionDto,
  ): Promise<SuggestionDto> {
    const reason = dto.reason?.trim() || null;
    const claimed = await this.suggestionRepository.claimFromPending(id, {
      status: AnalyticsSuggestionStatus.REJECTED,
      updatedBy: userId,
      rejectedReason: reason,
    });

    if (!claimed) {
      const existing = await this.suggestionRepository.findOne({
        where: { id },
      });
      if (!existing) throw new NotFoundException(`Suggestion ${id} not found`);
      throw new ConflictException(
        `This suggestion has already been ${existing.status}.`,
      );
    }

    const updated = await this.suggestionRepository.findOne({ where: { id } });
    if (!updated) throw new NotFoundException(`Suggestion ${id} not found`);
    return toSuggestionDto(updated);
  }

  // ── prompt assembly ─────────────────────────────────────────────────────────

  /**
   * The user message: the analytics payload, then the four context blocks that
   * keep a run from repeating the last one.
   *
   * "Already proposed" and "already rejected" are separate blocks on purpose. A
   * pending suggestion is an open question the reader has not answered yet, and a
   * rejected one is an answered question — telling the model they are the same
   * kind of thing invites it to re-argue decisions.
   */
  private async buildUserMessage(
    payload: {
      window: SuggestionWindow;
      sections: Record<string, unknown>;
      included: string[];
      failed: string[];
    },
    goalNames: string[],
  ): Promise<string> {
    const [opportunities, rejected, alreadyProposed] = await Promise.all([
      this.opportunityRepository.find({
        order: { createdAt: 'DESC' },
        take: SUGGESTION_CONTEXT_LIMITS.OPPORTUNITIES,
      }),
      this.suggestionRepository.findRecentRejected(),
      this.suggestionRepository.findRecentOpenOrAccepted(),
    ]);

    const parts: string[] = [];

    parts.push(
      `WINDOW: ${payload.window.label} (${payload.window.from} to ${payload.window.to}, inclusive)`,
    );

    if (payload.failed.length) {
      parts.push(
        `SECTIONS UNAVAILABLE FOR THIS WINDOW — say nothing about these:\n` +
          payload.failed.map((f) => `- ${f}`).join('\n'),
      );
    }

    parts.push(
      `ANALYTICS PAYLOAD (${payload.included.length} sections):\n` +
        JSON.stringify(payload.sections, null, 1),
    );

    parts.push(
      goalNames.length
        ? `LIVE PRODUCT GOALS — copy one of these names EXACTLY into suggestedGoal, or use null:\n` +
            goalNames.map((n) => `- ${n}`).join('\n')
        : `LIVE PRODUCT GOALS: none are defined, so suggestedGoal must be null for every suggestion.`,
    );

    parts.push(
      opportunities.length
        ? `ALREADY ON THE ROADMAP (${opportunities.length}) — do not re-propose these:\n` +
            opportunities
              .map(
                (o) =>
                  `- [${o.type}] (${o.productGoal}, ${o.stage}) ` +
                  o.description
                    .replace(/\s+/g, ' ')
                    .slice(0, SUGGESTION_CONTEXT_LIMITS.OPPORTUNITY_EXCERPT),
              )
              .join('\n')
        : `ALREADY ON THE ROADMAP: nothing yet.`,
    );

    if (alreadyProposed.length) {
      parts.push(
        `ALREADY PROPOSED AND AWAITING A DECISION (${alreadyProposed.length}) — do not repeat these:\n` +
          alreadyProposed.map((s) => `- ${s.title}`).join('\n'),
      );
    }

    if (rejected.length) {
      parts.push(
        `PREVIOUSLY REJECTED (${rejected.length}) — these are standing decisions, do not re-argue them:\n` +
          rejected
            .map(
              (s) =>
                `- ${s.title} — ${s.rejectedReason?.replace(/\s+/g, ' ') ?? 'no reason given'}`,
            )
            .join('\n'),
      );
    }

    parts.push('Return the JSON object now.');
    return parts.join('\n\n');
  }

  // ── validation ──────────────────────────────────────────────────────────────

  /**
   * Turn raw model output into rows that are safe to store.
   *
   * Every rule here drops or clamps rather than repairing: a suggestion with no
   * title or no body is not a suggestion, and a goal name the taxonomy does not
   * contain becomes null rather than being stored or guessed at.
   */
  private normalise(
    raw: RawSuggestion[],
    goalNames: string[],
  ): Partial<AnalyticsSuggestion>[] {
    const rows: Partial<AnalyticsSuggestion>[] = [];

    for (const item of raw) {
      if (rows.length >= MAX_SUGGESTIONS_PER_RUN) {
        this.logger.warn(
          `[SUGGESTIONS] Model returned more than ${MAX_SUGGESTIONS_PER_RUN} ` +
            `suggestions; the extras were discarded.`,
        );
        break;
      }

      const title = text(item.title, SUGGESTION_FIELD_LIMITS.TITLE);
      const body = text(item.body, SUGGESTION_FIELD_LIMITS.BODY);
      if (!title || !body) {
        this.logger.warn(
          '[SUGGESTIONS] Discarded a suggestion with no title or no body.',
        );
        continue;
      }

      const suggestedGoal =
        typeof item.suggestedGoal === 'string' &&
        goalNames.includes(item.suggestedGoal)
          ? item.suggestedGoal
          : null;
      if (item.suggestedGoal && !suggestedGoal) {
        this.logger.warn(
          `[SUGGESTIONS] Model classified a suggestion as "${String(
            item.suggestedGoal,
          )}", which is not a live product goal. Storing no goal rather than that.`,
        );
      }

      rows.push({
        title,
        body,
        rationale:
          text(item.rationale, SUGGESTION_FIELD_LIMITS.RATIONALE) ?? '',
        evidence: Array.isArray(item.evidence)
          ? item.evidence
              .map((e) => text(e, SUGGESTION_FIELD_LIMITS.EVIDENCE_ITEM))
              .filter((e): e is string => Boolean(e))
              .slice(0, SUGGESTION_FIELD_LIMITS.EVIDENCE_ITEMS)
          : [],
        suggestedGoal,
        suggestedType:
          item.suggestedType === RoadmapOpportunityType.BUG
            ? RoadmapOpportunityType.BUG
            : RoadmapOpportunityType.IDEA,
      });
    }

    return rows;
  }
}

/** Trim, collapse nothing, cap length. Returns null for anything unusable. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function toSuggestionDto(row: AnalyticsSuggestion): SuggestionDto {
  return {
    id: row.id,
    batchId: row.batchId,
    title: row.title,
    body: row.body,
    rationale: row.rationale ?? '',
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    suggestedGoal: row.suggestedGoal ?? null,
    suggestedType: row.suggestedType,
    status: row.status,
    rejectedReason: row.rejectedReason ?? null,
    opportunityId: row.opportunityId ?? null,
    window: {
      range: row.windowRange ?? null,
      from: String(row.windowFrom),
      to: String(row.windowTo),
      label: row.windowLabel,
    },
    model: row.model,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
