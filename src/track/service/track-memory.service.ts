import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { renderTemplate } from 'src/learn/util/autofill-shared.util';
import { TrackEnrollmentRepository } from '../repository/track-enrollment.repository';
import { TrackItemProgressRepository } from '../repository/track-item-progress.repository';
import { TrackItemRepository } from '../repository/track-item.repository';
import { TrackSectionRepository } from '../repository/track-section.repository';

const PROMPT_CODE = 'track_memory_fold';
const FOLD_TIMEOUT_MS = 30_000;
const FOLD_MAX_TOKENS = 1024;
/** Per-item source memory kept verbatim in enrollment.memory.items. */
const ITEM_SUMMARY_MAX_CHARS = 2400;
/** Consolidated summary bound (the LLM targets 1200; fallback is capped here). */
const CONSOLIDATED_MAX_CHARS = 2500;
/** Deterministic fallback folds only the most recent K item memories. */
const FALLBACK_ITEM_COUNT = 3;

interface TrackMemoryItemEntry {
  sessionId: string;
  summary: string;
  updatedAt: string;
}

export interface TrackEnrollmentMemory {
  summary?: string;
  items: Record<string, TrackMemoryItemEntry>;
  updatedAt?: string;
}

/**
 * QM-style fold/consolidation for Tracks: every conversation item's
 * end-of-session memory is folded into ONE evolving learner memory stored on
 * the track enrollment (track_enrollments.memory). The fold is an LLM merge
 * over the per-item source memories in track order (so a replayed item
 * replaces its own contribution instead of double-counting), with a
 * deterministic join fallback when the LLM is unavailable — consolidation
 * must never lose the source memories, only the polish.
 *
 * Trigger: SessionMemoryProcessor, right after a session_memory lands for a
 * session that belongs to a track (directly or through a nested case).
 * Read: getPreviousTrackMemory prefers the consolidated summary.
 */
@Injectable()
export class TrackMemoryService {
  private readonly logger = LoggerService.getInstance(TrackMemoryService.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    private readonly configService: AppConfigService,
    private readonly promptSharedService: PromptSharedService,
    private readonly llmUsage: LlmUsageService,
    private readonly trackEnrollmentRepository: TrackEnrollmentRepository,
    private readonly trackItemProgressRepository: TrackItemProgressRepository,
    private readonly trackItemRepository: TrackItemRepository,
    private readonly trackSectionRepository: TrackSectionRepository,
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.anthropic.apiKey,
    });
    this.model = this.configService.anthropic.autofillModel;
  }

  /**
   * Fold one session's memory into the enrollment's consolidated memory.
   * Idempotent per (item, session): re-delivery (the two-phase
   * session_memory upgrade) or a replay simply replaces that item's entry
   * and re-consolidates. Never throws — memory folding is best-effort.
   */
  async foldSessionMemory({
    trackItemProgressId,
    scenarioSessionId,
    summary,
  }: {
    trackItemProgressId: string;
    scenarioSessionId: string;
    summary: string;
  }): Promise<void> {
    try {
      if (!summary?.trim()) return;
      const progress = await this.trackItemProgressRepository.findOne({
        where: { id: trackItemProgressId },
      });
      if (!progress) return;
      const enrollment = await this.trackEnrollmentRepository.findOne({
        where: { id: progress.trackEnrollmentId },
      });
      if (!enrollment) return;

      const memory: TrackEnrollmentMemory = {
        items: {},
        ...(enrollment.memory as TrackEnrollmentMemory | undefined),
      };
      memory.items = { ...(memory.items ?? {}) };
      memory.items[progress.trackItemId] = {
        sessionId: scenarioSessionId,
        summary: summary.trim().slice(0, ITEM_SUMMARY_MAX_CHARS),
        updatedAt: new Date().toISOString(),
      };

      const orderedSummaries = await this.orderedItemSummaries(
        enrollment.trackId,
        memory.items,
      );
      memory.summary = await this.consolidate(orderedSummaries, {
        trackEnrollmentId: enrollment.id,
      });
      memory.updatedAt = new Date().toISOString();

      await this.trackEnrollmentRepository.update(enrollment.id, {
        memory: memory as Record<string, any>,
      });
      this.logger.info(
        `[TRACK_MEMORY] folded session=${scenarioSessionId} into enrollment=${enrollment.id} ` +
          `items=${Object.keys(memory.items).length} summary_chars=${memory.summary?.length ?? 0}`,
      );
    } catch (error) {
      this.logger.error(
        `[TRACK_MEMORY] fold failed for progress=${trackItemProgressId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * The consolidated memory a track item should open with, or null when the
   * enrollment has none yet (first conversation item / folds all failed).
   */
  async getConsolidatedMemory(
    trackItemProgressId: string,
  ): Promise<string | null> {
    const progress = await this.trackItemProgressRepository.findOne({
      where: { id: trackItemProgressId },
    });
    if (!progress) return null;
    const enrollment = await this.trackEnrollmentRepository.findOne({
      where: { id: progress.trackEnrollmentId },
    });
    const summary = (enrollment?.memory as TrackEnrollmentMemory | undefined)
      ?.summary;
    return typeof summary === 'string' && summary.trim()
      ? summary.trim()
      : null;
  }

  /** Per-item source memories in track order (sections, then item order). */
  private async orderedItemSummaries(
    trackId: string,
    items: Record<string, TrackMemoryItemEntry>,
  ): Promise<string[]> {
    const [sections, trackItems] = await Promise.all([
      this.trackSectionRepository.find({
        where: { trackId },
        order: { order: 'ASC' },
      }),
      this.trackItemRepository.find({ where: { trackId } }),
    ]);
    const orderedIds = sections.flatMap((section) =>
      trackItems
        .filter((i) => i.trackSectionId === section.id)
        .sort((a, b) => a.order - b.order)
        .map((i) => i.id),
    );
    const ordered = orderedIds
      .filter((id) => items[id]?.summary)
      .map((id) => items[id].summary);
    // Defensive: entries whose item vanished from the track still count,
    // appended after the ordered ones.
    const known = new Set(orderedIds);
    for (const [id, entry] of Object.entries(items)) {
      if (!known.has(id) && entry.summary) ordered.push(entry.summary);
    }
    return ordered;
  }

  /** LLM merge with a deterministic join fallback. */
  private async consolidate(
    orderedSummaries: string[],
    usageMetadata: Record<string, any>,
  ): Promise<string> {
    if (orderedSummaries.length === 0) return '';
    if (orderedSummaries.length === 1) {
      return orderedSummaries[0].slice(0, CONSOLIDATED_MAX_CHARS);
    }

    try {
      const template =
        await this.promptSharedService.getPromptByCode(PROMPT_CODE);
      if (!template) throw new Error(`prompt '${PROMPT_CODE}' not found`);
      const prompt = renderTemplate(template, {
        sessionMemories: orderedSummaries
          .map((s, i) => `### Session ${i + 1}\n${s}`)
          .join('\n\n'),
      });

      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: FOLD_MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        },
        { timeout: FOLD_TIMEOUT_MS },
      );

      const input = response.usage?.input_tokens ?? 0;
      const output = response.usage?.output_tokens ?? 0;
      void this.llmUsage.record({
        provider: 'anthropic',
        model: this.model,
        task: LlmTask.TRACK_MEMORY_FOLD,
        promptTokens: input,
        completionTokens: output,
        totalTokens: input + output,
        metadata: usageMetadata,
      });

      const block = response.content[0];
      const text = (block?.type === 'text' ? block.text : '').trim();
      if (!text) throw new Error('empty fold response');
      return text.slice(0, CONSOLIDATED_MAX_CHARS);
    } catch (error) {
      this.logger.warn(
        `[TRACK_MEMORY] LLM fold failed, using join fallback: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return orderedSummaries
        .slice(-FALLBACK_ITEM_COUNT)
        .join('\n')
        .slice(-CONSOLIDATED_MAX_CHARS);
    }
  }
}
