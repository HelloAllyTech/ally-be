import { randomUUID } from 'crypto';
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
const FACTS_PROMPT_CODE = 'track_memory_facts';
const FOLD_TIMEOUT_MS = 30_000;
const FOLD_MAX_TOKENS = 1024;
const FACTS_MAX_TOKENS = 2048;
/** Per-item source memory kept verbatim in enrollment.memory.items. */
const ITEM_SUMMARY_MAX_CHARS = 2400;
/** Consolidated summary bound (the LLM targets 1200; fallback is capped here). */
const CONSOLIDATED_MAX_CHARS = 2500;
/** Deterministic fallback folds only the most recent K item memories. */
const FALLBACK_ITEM_COUNT = 3;
/** Active learned facts kept per enrollment (newest win beyond the cap). */
const MAX_ACTIVE_FACTS = 40;
const FACT_MAX_CHARS = 160;
/** Bound of the facts block appended to the injected previousMemory. */
const FACTS_BLOCK_MAX_CHARS = 1600;

interface TrackMemoryItemEntry {
  sessionId: string;
  summary: string;
  updatedAt: string;
}

export interface TrackLearnedFact {
  id: string;
  fact: string;
  status: 'active' | 'superseded';
  sourceSessionId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TrackEnrollmentMemory {
  summary?: string;
  items: Record<string, TrackMemoryItemEntry>;
  /**
   * Semantic learned-facts list (option-1 store): atomic, durable client
   * facts extracted from sessionMemory.structured.disclosures, individually
   * supersedable so narrative re-summarization can never silently drop them.
   */
  facts?: TrackLearnedFact[];
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
    disclosures,
  }: {
    trackItemProgressId: string;
    scenarioSessionId: string;
    summary: string;
    /** sessionMemory.structured.disclosures — the atomic facts source. */
    disclosures?: string[];
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
      memory.facts = await this.consolidateFacts(
        memory.facts ?? [],
        disclosures ?? [],
        scenarioSessionId,
        { trackEnrollmentId: enrollment.id },
      );
      memory.updatedAt = new Date().toISOString();

      await this.trackEnrollmentRepository.update(enrollment.id, {
        memory: memory as Record<string, any>,
      });
      const activeFacts = (memory.facts ?? []).filter(
        (f) => f.status === 'active',
      ).length;
      this.logger.info(
        `[TRACK_MEMORY] folded session=${scenarioSessionId} into enrollment=${enrollment.id} ` +
          `items=${Object.keys(memory.items).length} summary_chars=${memory.summary?.length ?? 0} ` +
          `facts=${activeFacts} active/${(memory.facts ?? []).length} total`,
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
   * Composition: narrative summary + the active learned facts. Facts ride
   * along even when the narrative eventually compresses them out — that is
   * the whole point of the fact list.
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
    const memory = enrollment?.memory as TrackEnrollmentMemory | undefined;
    const summary =
      typeof memory?.summary === 'string' ? memory.summary.trim() : '';

    let factsBlock = '';
    const active = (memory?.facts ?? []).filter(
      (f) => f.status === 'active' && f.fact?.trim(),
    );
    if (active.length > 0) {
      const lines: string[] = [];
      let budget = FACTS_BLOCK_MAX_CHARS;
      // Newest last in storage; keep the newest facts when over budget.
      for (const f of [...active].reverse()) {
        const line = `- ${f.fact.trim()}`;
        if (budget - line.length - 1 < 0) break;
        budget -= line.length + 1;
        lines.unshift(line);
      }
      factsBlock = `Facts you know about your own situation from earlier sessions:\n${lines.join('\n')}`;
    }

    const composed = [summary, factsBlock].filter(Boolean).join('\n\n');
    if (composed) {
      this.logger.info(
        `[TRACK_MEMORY] read enrollment=${enrollment?.id} ` +
          `summary_chars=${summary.length} facts_injected=${
            factsBlock ? active.length : 0
          } facts_block_chars=${factsBlock.length}`,
      );
    }
    return composed || null;
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

  /**
   * Merge the latest session's disclosures into the learned-facts list:
   * LLM dedupe/supersession with a deterministic append fallback. Existing
   * facts are never dropped (only marked superseded); the LLM result is
   * reconciled against the previous list so a hallucinated omission can't
   * erase a fact.
   */
  private async consolidateFacts(
    existing: TrackLearnedFact[],
    disclosures: string[],
    scenarioSessionId: string,
    usageMetadata: Record<string, any>,
  ): Promise<TrackLearnedFact[]> {
    const newDisclosures = (disclosures ?? [])
      .map((d) => (d ?? '').trim())
      .filter(Boolean)
      .map((d) => d.slice(0, FACT_MAX_CHARS));
    if (newDisclosures.length === 0) return existing;

    const now = new Date().toISOString();
    const byId = new Map(existing.map((f) => [f.id, f]));

    let updated: TrackLearnedFact[] | null = null;
    try {
      const template =
        await this.promptSharedService.getPromptByCode(FACTS_PROMPT_CODE);
      if (!template) throw new Error(`prompt '${FACTS_PROMPT_CODE}' not found`);
      const prompt = renderTemplate(template, {
        existingFacts: JSON.stringify(
          existing.map(({ id, fact, status }) => ({ id, fact, status })),
        ),
        newDisclosures: newDisclosures.map((d) => `- ${d}`).join('\n'),
      });

      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: FACTS_MAX_TOKENS,
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
        metadata: { ...usageMetadata, stage: 'facts' },
      });

      const block = response.content[0];
      const raw = (block?.type === 'text' ? block.text : '').trim();
      const jsonStart = raw.indexOf('[');
      const parsed = JSON.parse(
        raw.slice(jsonStart, raw.lastIndexOf(']') + 1),
      ) as Array<{ id?: string; fact?: string; status?: string }>;

      updated = [];
      const seenIds = new Set<string>();
      for (const entry of parsed) {
        const fact = (entry.fact ?? '').trim().slice(0, FACT_MAX_CHARS);
        if (!fact) continue;
        const status: TrackLearnedFact['status'] =
          entry.status === 'superseded' ? 'superseded' : 'active';
        const prior = entry.id ? byId.get(entry.id) : undefined;
        if (prior) {
          seenIds.add(prior.id);
          updated.push({
            ...prior,
            fact,
            status,
            updatedAt:
              fact !== prior.fact || status !== prior.status
                ? now
                : prior.updatedAt,
          });
        } else {
          updated.push({
            id: randomUUID(),
            fact,
            status,
            sourceSessionId: scenarioSessionId,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
      // Reconcile: any existing fact the LLM omitted is kept unchanged —
      // omission must never delete memory.
      for (const f of existing) {
        if (!seenIds.has(f.id)) updated.push(f);
      }
    } catch (error) {
      this.logger.warn(
        `[TRACK_MEMORY] LLM facts consolidation failed, using append fallback: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // Deterministic fallback: append disclosures not already present
      // (normalized exact match), all active.
      const normalized = new Set(
        existing.map((f) => f.fact.toLowerCase().replace(/\s+/g, ' ').trim()),
      );
      updated = [...existing];
      for (const d of newDisclosures) {
        const key = d.toLowerCase().replace(/\s+/g, ' ').trim();
        if (normalized.has(key)) continue;
        normalized.add(key);
        updated.push({
          id: randomUUID(),
          fact: d,
          status: 'active',
          sourceSessionId: scenarioSessionId,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Cap: keep every superseded entry (audit trail is cheap) but bound the
    // ACTIVE list — beyond the cap the oldest actives get superseded.
    const actives = updated.filter((f) => f.status === 'active');
    if (actives.length > MAX_ACTIVE_FACTS) {
      const toRetire = actives
        .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
        .slice(0, actives.length - MAX_ACTIVE_FACTS);
      const retireIds = new Set(toRetire.map((f) => f.id));
      updated = updated.map((f) =>
        retireIds.has(f.id)
          ? { ...f, status: 'superseded', updatedAt: now }
          : f,
      );
    }
    return updated;
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
