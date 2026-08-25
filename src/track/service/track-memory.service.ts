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

/**
 * Comparison form of a fact. Shared by the two places that ask "is this the
 * same fact?" — the LLM path's identity resolution and the fallback path's
 * duplicate check — so the two can never disagree about what counts as
 * unchanged wording.
 */
const normalizeFact = (fact: string): string =>
  fact.toLowerCase().replace(/\s+/g, ' ').trim();

interface TrackMemoryItemEntry {
  sessionId: string;
  summary: string;
  updatedAt: string;
}

export interface TrackLearnedFact {
  id: string;
  fact: string;
  /**
   * Why this fact is or is not injected — and the two non-active reasons are
   * NOT interchangeable.
   *
   * `superseded` is SEMANTIC: a later session contradicted it, so it stopped
   * being true. Decided by the merge model, and the entry is the audit trail
   * of when the truth changed.
   *
   * `retired` is MECHANICAL: it is still true, we simply ran out of room under
   * MAX_ACTIVE_FACTS. Decided by array length, not by anything the client said.
   *
   * Collapsing both into `superseded` (as this did until the third state was
   * added) makes the trail unreadable — you cannot tell why a fact left — and
   * loses the ability to ever bring an evicted-but-true fact back, because
   * there is no way left to find it. The merge model is never shown or told
   * about `retired`; only the two states it decides.
   */
  status: 'active' | 'superseded' | 'retired';
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
   * Never throws — memory folding is best-effort.
   *
   * `items` and `summary` are idempotent per (item, session) BY CONSTRUCTION:
   * re-delivery (the two-phase session_memory upgrade, which happens on every
   * session) or a replay replaces that item's entry and re-consolidates from
   * the replaced set.
   *
   * `facts` is NOT — it is an accumulator, and the same session's disclosures
   * are re-submitted on every re-delivery. Nothing structural stops that
   * double-counting; it rests entirely on the merge step recognising a
   * restatement. That was checked against the live model rather than assumed
   * (five facts re-sent as seven reworded disclosures came back as the same
   * five plus the two genuinely new ones), so this is a known and measured
   * dependency, not an oversight. If the merge model is ever changed, re-check
   * it — the failure would be silent duplicate facts.
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
      const allFacts = memory.facts ?? [];
      const countOf = (status: TrackLearnedFact['status']) =>
        allFacts.filter((f) => f.status === status).length;
      // The breakdown is the whole telemetry for this store: "N active/N total"
      // alone cannot distinguish a fact that stopped being true from one
      // evicted for space, which is exactly the question the status split
      // exists to answer.
      this.logger.info(
        `[TRACK_MEMORY] folded session=${scenarioSessionId} into enrollment=${enrollment.id} ` +
          `items=${Object.keys(memory.items).length} summary_chars=${memory.summary?.length ?? 0} ` +
          `facts=${countOf('active')} active/${allFacts.length} total ` +
          `superseded=${countOf('superseded')} retired=${countOf('retired')}`,
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
      // Retired facts are withheld from the model: it only reasons in
      // active/superseded, and showing it a third state it was never taught
      // invites it to echo one back. Withholding them is safe BY
      // CONSTRUCTION — an entry the model never sees is never claimed, so the
      // reconciliation loop below preserves it verbatim, `retired` intact.
      //
      // It also buys the resurrection path. `byText` is built from ALL of
      // `existing`, retired included, so if a retired fact is disclosed again
      // it binds to that entry by text and comes back with its ORIGINAL id and
      // provenance rather than as a duplicate — which is the whole point of
      // distinguishing "evicted for space" from "no longer true".
      const prompt = renderTemplate(template, {
        existingFacts: JSON.stringify(
          existing
            .filter((f) => f.status !== 'retired')
            .map(({ id, fact, status }) => ({ id, fact, status })),
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

      const entries = parsed
        .map((entry) => ({
          id: entry.id,
          fact: (entry.fact ?? '').trim().slice(0, FACT_MAX_CHARS),
          status: (entry.status === 'superseded'
            ? 'superseded'
            : 'active') as TrackLearnedFact['status'],
        }))
        .filter((entry) => entry.fact);

      // A FACT'S IDENTITY FOLLOWS ITS TEXT, NOT THE SLOT THE MODEL PUT IT IN.
      //
      // Asked to supersede, the model reads an id as belonging to the TOPIC
      // rather than to the fact: it reassigns the existing id to the new fact
      // and invents `old-<id>` for the original. Observed against the live
      // model on a three-way contradiction — every one of the three came back
      // that way round. Resolving by id alone then inverts the bookkeeping:
      // the original's text is overwritten in place while a fresh uuid is
      // minted for it, stamped with TODAY's session and createdAt. That
      // falsifies the audit trail the superseded rows exist to be, moves a
      // fact's durable id every time it is revised, and leaves the
      // MAX_ACTIVE_FACTS retirement sorting on a createdAt that no longer
      // describes the fact carrying it.
      //
      // So: bind by verbatim text first, and only then by id. An entry whose
      // text is unchanged IS that fact whatever id it arrived under; an id is
      // just the fallback for a fact whose wording genuinely changed.
      const claimedIds = new Set<string>();
      const resolved: Array<TrackLearnedFact | undefined> = new Array(
        entries.length,
      );
      const byText = new Map<string, TrackLearnedFact>();
      for (const f of existing) {
        const key = normalizeFact(f.fact);
        if (!byText.has(key)) byText.set(key, f);
      }

      entries.forEach((entry, i) => {
        const prior = byText.get(normalizeFact(entry.fact));
        if (prior && !claimedIds.has(prior.id)) {
          claimedIds.add(prior.id);
          resolved[i] = prior;
        }
      });
      entries.forEach((entry, i) => {
        if (resolved[i]) return;
        const prior = entry.id ? byId.get(entry.id) : undefined;
        if (prior && !claimedIds.has(prior.id)) {
          claimedIds.add(prior.id);
          resolved[i] = prior;
        }
      });

      updated = entries.map((entry, i) => {
        const prior = resolved[i];
        if (!prior) {
          return {
            id: randomUUID(),
            fact: entry.fact,
            status: entry.status,
            sourceSessionId: scenarioSessionId,
            createdAt: now,
            updatedAt: now,
          };
        }
        return {
          ...prior,
          fact: entry.fact,
          status: entry.status,
          updatedAt:
            entry.fact !== prior.fact || entry.status !== prior.status
              ? now
              : prior.updatedAt,
        };
      });
      // Reconcile: any existing fact the LLM omitted is kept unchanged —
      // omission must never delete memory.
      for (const f of existing) {
        if (!claimedIds.has(f.id)) updated.push(f);
      }
    } catch (error) {
      this.logger.warn(
        `[TRACK_MEMORY] LLM facts consolidation failed, using append fallback: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // Deterministic fallback: append disclosures not already present
      // (normalized exact match), all active.
      const normalized = new Set(existing.map((f) => normalizeFact(f.fact)));
      updated = [...existing];
      for (const d of newDisclosures) {
        const key = normalizeFact(d);
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

    // Cap: keep every inactive entry (the trail is cheap) but bound the ACTIVE
    // list — beyond the cap the oldest actives are RETIRED, not superseded.
    // They are still true; there is simply no room. See TrackLearnedFact.status.
    //
    // Retiring by age is a placeholder policy, not a considered one: in a
    // counselling arc the OLDEST facts tend to be the load-bearing ones ("mother
    // has been unwell since January") and the newest the incidental ones, so
    // this evicts roughly the wrong end. It has never once fired in production
    // — the cap is 40 and the largest enrollment holds 16 — which is why it is
    // left alone rather than replaced by a relevance policy that could not be
    // evaluated against zero evictions. The log below is what turns the first
    // real eviction into something we find out about instead of infer later.
    const actives = updated.filter((f) => f.status === 'active');
    if (actives.length > MAX_ACTIVE_FACTS) {
      const toRetire = [...actives]
        .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
        .slice(0, actives.length - MAX_ACTIVE_FACTS);
      const retireIds = new Set(toRetire.map((f) => f.id));
      updated = updated.map((f) =>
        retireIds.has(f.id) ? { ...f, status: 'retired', updatedAt: now } : f,
      );
      this.logger.warn(
        `[TRACK_MEMORY] fact cap reached: retiring ${retireIds.size} still-true ` +
          `fact(s) to hold ${MAX_ACTIVE_FACTS} active — oldest first, which is ` +
          `probably the wrong end. Retired ids: ${[...retireIds].join(', ')}`,
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
