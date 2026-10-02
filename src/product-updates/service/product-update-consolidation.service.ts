import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

import { LoggerService } from 'src/logger/logger.service';

import {
  EditableUpdateField,
  UpdateArea,
} from '../constants/product-update.constants';
import {
  ProductUpdateSource,
  ProductUpdateSourceStatus,
} from '../entity/product-update-source.entity';
import { ProductUpdate } from '../entity/product-update.entity';
import { ProductUpdateSourceRepository } from '../repository/product-update-source.repository';
import { ProductUpdateRepository } from '../repository/product-update.repository';
import {
  ClusterInput,
  ConsolidationDecision,
  DraftUpdate,
  OpenUpdateInput,
  enforceGuards,
} from '../util/consolidation.util';
import {
  SourceSignalsInput,
  buildClusters,
  isNoise,
  looksStaffOnly,
} from '../util/source-signals.util';
import { ProductUpdatesAiService } from './product-updates-ai.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Sources read per batch — the pool clusters are formed from. */
const SOURCE_POOL = 300;
/**
 * Clusters sent to the model per call. Measured on real journal weeks with the
 * reasoning tier: 29 clusters took ~9.6k output tokens including reasoning,
 * and 72 overran a 16k budget and came back truncated with no JSON at all.
 * 20 keeps a batch well inside `CONSOLIDATION_LLM.MAX_TOKENS`.
 */
const CLUSTERS_PER_CALL = 20;
/** How far back an open update may still absorb new work, measured from its last merge. */
const OPEN_MERGED_WITHIN_MS = 10 * DAY_MS;
/** A public update stops being rewritten this long after it was published. */
const OPEN_PUBLISHED_WITHIN_MS = 3 * DAY_MS;
/** After this many failed attempts a change is filed as its own internal update rather than lost. */
const MAX_CONSOLIDATE_ATTEMPTS = 4;

/**
 * Fields an attach may still change on an update that is already public. The
 * audience and kind of something customers have read are a person's call, not
 * a follow-up merge's.
 */
const PUBLISHED_REVISABLE: EditableUpdateField[] = [
  'title',
  'summary',
  'teamNotes',
  'surfaces',
  'area',
];

export interface ConsolidationBatchResult {
  /** True when nothing was waiting — the caller can stop looping. */
  done: boolean;
  noise: number;
  clusters: number;
  created: number;
  attached: number;
  unresolved: number;
  forced: number;
  model: string | null;
  error: string | null;
}

/**
 * Enriched merges → product updates. The only writer of update text.
 *
 * One batch: take the oldest waiting merges, drop the ones that are noise by
 * rule, cluster the rest on hard evidence, and ask the model to place each
 * cluster — as a new update, onto an open one, or as noise. Everything the
 * model says is checked (`parseConsolidationOutput`) before it is saved, and a
 * field a person has edited is never written again.
 */
@Injectable()
export class ProductUpdateConsolidationService {
  private readonly logger = LoggerService.getInstance(
    ProductUpdateConsolidationService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly sourceRepository: ProductUpdateSourceRepository,
    private readonly updateRepository: ProductUpdateRepository,
    private readonly ai: ProductUpdatesAiService,
  ) {}

  async consolidateBatch(params: {
    now: Date;
    /** Merges younger than this wait, so a backend PR and its frontend PR arrive together. */
    settleMs: number;
  }): Promise<ConsolidationBatchResult> {
    const result: ConsolidationBatchResult = {
      done: false,
      noise: 0,
      clusters: 0,
      created: 0,
      attached: 0,
      unresolved: 0,
      forced: 0,
      model: null,
      error: null,
    };

    const pool = await this.sourceRepository.findByStatus(
      ProductUpdateSourceStatus.ENRICHED,
      {
        limit: SOURCE_POOL,
        mergedBefore: new Date(params.now.getTime() - params.settleMs),
      },
    );
    if (pool.length === 0) return { ...result, done: true };

    const noise = pool.filter((source) => isNoise(signalsOf(source)));
    if (noise.length) {
      await this.markNoise(noise, params.now);
      result.noise = noise.length;
    }

    const candidates = pool.filter((source) => !noise.includes(source));
    if (candidates.length === 0) return result;

    const clustered = buildClusters(candidates.map(signalsOf))
      .slice(0, CLUSTERS_PER_CALL)
      .map((indexes) => indexes.map((index) => candidates[index]));
    result.clusters = clustered.length;

    const batchSources = clustered.flat();
    const batchEnd = maxDate(batchSources.map((source) => source.mergedAt));
    const batchStart = minDate(batchSources.map((source) => source.mergedAt));

    const openUpdates = await this.updateRepository.findOpen({
      mergedSince: new Date(batchStart.getTime() - OPEN_MERGED_WITHIN_MS),
      publishedSince: new Date(batchEnd.getTime() - OPEN_PUBLISHED_WITHIN_MS),
      limit: 40,
    });

    const clusterInputs: ClusterInput[] = clustered.map((sources, index) => ({
      id: `c${index + 1}`,
      sources: sources.map((source) => ({
        repo: source.repo,
        prNumber: source.prNumber,
        headRef: source.headRef,
        author: source.author,
        mergedAt: source.mergedAt,
        subjects: source.subjects,
        body: source.body,
        files: source.files,
        staffOnlyHint: looksStaffOnly(signalsOf(source)),
      })),
    }));
    const byClusterId = new Map(
      clusterInputs.map((input, index) => [input.id, clustered[index]]),
    );

    let decisions: ConsolidationDecision[];
    let unresolvedIds: string[];
    try {
      const { parsed, model } = await this.ai.consolidate(
        clusterInputs,
        openUpdates.map(toOpenUpdateInput),
      );
      decisions = parsed.decisions;
      unresolvedIds = parsed.unresolvedClusterIds;
      result.model = model;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[PRODUCT-UPDATES] Consolidation call failed: ${message}`,
      );
      result.error = message;
      decisions = [];
      unresolvedIds = clusterInputs.map((input) => input.id);
    }

    const openById = new Map(openUpdates.map((update) => [update.id, update]));
    await this.dataSource.transaction(async (manager) => {
      for (const decision of decisions) {
        const sources = decision.clusterIds.flatMap(
          (id) => byClusterId.get(id) ?? [],
        );
        if (decision.action === 'noise') {
          await this.markNoise(sources, params.now, manager);
          result.noise += sources.length;
        } else if (decision.action === 'new') {
          const { guardNotes, ...draft } = enforceGuards(decision.update);
          const update = await this.createUpdate(manager, draft, sources, {
            model: result.model,
            reason: [decision.reason, ...guardNotes].filter(Boolean).join(' '),
          });
          openById.set(update.id, update);
          await this.attachSources(manager, update.id, sources, params.now);
          result.created += 1;
        } else {
          const update = openById.get(decision.updateId);
          if (!update) continue;
          const { guardNotes, ...draft } = enforceGuards(decision.update);
          await this.reviseUpdate(manager, update, draft, sources, {
            model: result.model,
            reason: [decision.reason, ...guardNotes].filter(Boolean).join(' '),
          });
          await this.attachSources(manager, update.id, sources, params.now);
          result.attached += 1;
        }
      }

      for (const id of unresolvedIds) {
        const sources = byClusterId.get(id) ?? [];
        const attempts =
          Math.max(...sources.map((source) => source.consolidateAttempts)) + 1;
        if (attempts >= MAX_CONSOLIDATE_ATTEMPTS) {
          const update = await this.createUpdate(
            manager,
            fallbackDraft(sources),
            sources,
            {
              model: null,
              reason: `Could not be placed automatically after ${attempts} attempts; filed as internal so it is not lost.`,
            },
          );
          await this.attachSources(manager, update.id, sources, params.now);
          result.forced += 1;
          continue;
        }
        await manager.getRepository(ProductUpdateSource).update(
          { id: In(sources.map((source) => source.id)) },
          {
            consolidateAttempts: attempts,
            lastError: result.error ?? 'The model did not place this change.',
          },
        );
        result.unresolved += 1;
      }
    });

    return result;
  }

  private async markNoise(
    sources: ProductUpdateSource[],
    now: Date,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<void> {
    if (sources.length === 0) return;
    await manager.getRepository(ProductUpdateSource).update(
      { id: In(sources.map((source) => source.id)) },
      {
        status: ProductUpdateSourceStatus.NOISE,
        consolidatedAt: now,
        updateId: null,
        lastError: null,
      },
    );
  }

  private async attachSources(
    manager: EntityManager,
    updateId: string,
    sources: ProductUpdateSource[],
    now: Date,
  ): Promise<void> {
    await manager.getRepository(ProductUpdateSource).update(
      { id: In(sources.map((source) => source.id)) },
      {
        status: ProductUpdateSourceStatus.CONSOLIDATED,
        updateId,
        consolidatedAt: now,
        lastError: null,
      },
    );
  }

  private async createUpdate(
    manager: EntityManager,
    draft: DraftUpdate,
    sources: ProductUpdateSource[],
    meta: { model: string | null; reason: string },
  ): Promise<ProductUpdate> {
    const mergedTimes = sources.map((source) => source.mergedAt);
    const firstMergedAt = minDate(mergedTimes);
    const repository = manager.getRepository(ProductUpdate);
    const update = repository.create({
      slug: await this.uniqueSlug(manager, firstMergedAt, draft.title),
      title: draft.title,
      summary: draft.summary,
      teamNotes: draft.teamNotes,
      kind: draft.kind,
      audience: draft.audience,
      surfaces: draft.surfaces,
      area: draft.area,
      confidence: draft.confidence,
      firstMergedAt,
      lastMergedAt: maxDate(mergedTimes),
      liveAt: null,
      publishedAt: null,
      model: meta.model,
      decisionReason: meta.reason || null,
    });
    return repository.save(update);
  }

  private async reviseUpdate(
    manager: EntityManager,
    update: ProductUpdate,
    draft: Partial<DraftUpdate>,
    sources: ProductUpdateSource[],
    meta: { model: string | null; reason: string },
  ): Promise<void> {
    const published = Boolean(update.publishedAt);
    const locked = new Set(update.editedFields);
    const assign = <K extends EditableUpdateField>(field: K) => {
      const value = (draft as Record<string, unknown>)[field];
      if (value === undefined || locked.has(field)) return;
      if (published && !PUBLISHED_REVISABLE.includes(field)) return;
      (update as unknown as Record<string, unknown>)[field] = value;
    };
    (
      [
        'title',
        'summary',
        'teamNotes',
        'kind',
        'audience',
        'surfaces',
        'area',
      ] as const
    ).forEach(assign);
    if (draft.confidence !== undefined) update.confidence = draft.confidence;

    const mergedTimes = sources.map((source) => source.mergedAt);
    update.firstMergedAt = minDate([update.firstMergedAt, ...mergedTimes]);
    update.lastMergedAt = maxDate([update.lastMergedAt, ...mergedTimes]);
    // Not yet public: the new work has to be live too before it is. Already
    // public: it stays up — a follow-up fix must not pull an announcement
    // off the page while it waits for its own release.
    if (!published) update.liveAt = null;
    if (meta.model) update.model = meta.model;
    if (meta.reason) update.decisionReason = meta.reason;
    // The revised text as a whole, not just the fields this reply changed.
    const recheck = enforceGuards({
      title: update.title,
      summary: update.summary,
      audience: update.audience,
      confidence: update.confidence,
    });
    update.confidence = recheck.confidence ?? update.confidence;

    await manager.getRepository(ProductUpdate).save(update);
  }

  private async uniqueSlug(
    manager: EntityManager,
    firstMergedAt: Date,
    title: string,
  ): Promise<string> {
    const base =
      `${firstMergedAt.toISOString().slice(0, 10)}-${slugify(title)}`.slice(
        0,
        110,
      );
    const repository = manager.getRepository(ProductUpdate);
    let slug = base;
    for (
      let suffix = 2;
      await repository.exists({ where: { slug } });
      suffix += 1
    ) {
      slug = `${base}-${suffix}`;
    }
    return slug;
  }
}

function signalsOf(source: ProductUpdateSource): SourceSignalsInput {
  return {
    repo: source.repo,
    author: source.author,
    mergedAt: source.mergedAt,
    headRef: source.headRef,
    prNumber: source.prNumber,
    subjects: source.subjects,
    body: source.body,
    files: source.files,
  };
}

function toOpenUpdateInput(update: ProductUpdate): OpenUpdateInput {
  return {
    id: update.id,
    title: update.title,
    summary: update.summary,
    kind: update.kind,
    audience: update.audience,
    surfaces: update.surfaces,
    published: Boolean(update.publishedAt),
    editedFields: update.editedFields,
    sourceSubjects: (update.sources ?? []).flatMap((source) => source.subjects),
  };
}

/** What a change is filed as when the model could not place it: visible to staff, never public. */
function fallbackDraft(sources: ProductUpdateSource[]): DraftUpdate {
  const subjects = sources.flatMap((source) => source.subjects).filter(Boolean);
  const repos = [...new Set(sources.map((source) => source.repo))];
  return {
    title: (subjects[0] ?? 'Unplaced change').slice(0, 90),
    summary: `A change in ${repos.join(', ')} that the product-updates job could not place. Check it and edit or hide it.`,
    teamNotes: subjects.map((subject) => `- ${subject}`).join('\n'),
    kind: 'improved',
    audience: 'internal',
    surfaces: ['admin_console'],
    area: 'Staff tools' satisfies UpdateArea,
    confidence: 0,
  };
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      // Drop combining marks first: NFKD splits "é" into "e" + a mark, and a
      // bare mark would otherwise become a hyphen mid-word ("re-sume").
      .replace(/\p{M}/gu, '')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'update'
  );
}

function minDate(dates: Date[]): Date {
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

function maxDate(dates: Date[]): Date {
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}
