import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { LlmProviderFactory } from 'src/ai-chat/provider/llm-provider.factory';
import { excludeTestTenants } from 'src/analytics/util/test-tenant.util';
import { AppConfigService } from 'src/config/config.service';
import { Prompt } from 'src/prompt/entity/prompt.entity';
import { PromptVersion } from 'src/prompt/entity/prompt-version.entity';
import { LanguageErrorAnnotation } from 'src/learn/entity/language-error-annotation.entity';
import {
  GLOSSARY_CONSOLIDATION_ANNOTATION_LIMIT,
  GLOSSARY_CONSOLIDATION_DIMENSIONS,
  GLOSSARY_CONSOLIDATION_PROMPT_CODE,
  GLOSSARY_CONSOLIDATION_RECENCY_DAYS,
  GLOSSARY_GENERATION_PROMPT_CODE,
  GLOSSARY_LEXICAL_CONTRADICTION_MIN,
  GLOSSARY_MIN_CLUSTER_SUPPORT,
  GLOSSARY_SYSTEMATIC_MIN,
  TIER0_TOKEN_CAP,
  TIER_ERROR_MASS_WEIGHT,
  TIER_HYSTERESIS,
  TIER_SEVERITY_WEIGHTS,
} from '../constants/glossary.constants';
import {
  applySupportGate,
  clusterAnnotations,
  countOccurrences,
  scoreLexicalEvidence,
  summarizeClusters,
  systematicFluency,
} from '../util/construct-class.util';
import {
  tokenize,
  varietyTargetDescriptor,
} from '../util/variety-feature.util';
import {
  compileRegisterPolicy,
  resolveTargetVariety,
} from '../util/register-policy.util';
import {
  computeTierAssignment,
  TierAssignment,
  TierCandidate,
} from '../util/tier-assignment.util';
import { UpsertGlossarySectionDto } from '../dto/glossary-section.dto';
import {
  GlossaryEntryStatus,
  GlossaryInjectionMode,
  GlossarySectionStatus,
  LanguageGlossarySection,
} from '../entity/language-glossary-section.entity';
import {
  ConsolidationBatchEntry,
  ConsolidationBatchStatus,
  GlossaryConsolidationBatch,
} from '../entity/glossary-consolidation-batch.entity';
import { VarietyProfileAttachment } from '../entity/variety-profile-attachment.entity';
import {
  LanguageVarietyProfile,
  VarietyProfileStatus,
} from '../entity/language-variety-profile.entity';
import { LanguagesRepository } from '../repository/languages.repository';
import { LanguageGlossaryRepository } from '../repository/language-glossary.repository';
import {
  compileSection,
  compileTier0Glossary,
  countGlossaryTokens,
} from '../util/glossary-compiler.util';
import {
  GlossaryDedupeIndex,
  normalizeMarkdown,
} from '../util/glossary-dedupe.util';
import { excludeForeignScripts } from '../util/script-consistency.util';

export interface GlossarySectionView {
  section: LanguageGlossarySection;
  compiledTokens: number;
}

export interface GlossaryListResponse {
  sections: GlossarySectionView[];
  tier0Tokens: number;
  tier0TokenCap: number;
}

interface GeneratedSection {
  sectionCode: string;
  title: string;
  injectionMode: string;
  retrievalHint?: string;
  /** Markdown body — what admins edit and what the agent gets. */
  content: string;
}

interface ConsolidatedProposal {
  markdown: string;
  importance?: number;
  sourceAnnotationIndexes?: number[];
}

interface ConsolidatedEngineeringFinding {
  summary: string;
  sourceAnnotationIndexes?: number[];
}

interface ConsolidatedSection {
  sectionCode: string;
  title?: string;
  injectionMode?: string;
  retrievalHint?: string;
  proposals: ConsolidatedProposal[];
}

export interface BackfillGlossariesOutcome {
  languageId: number;
  value: string;
  created: string[];
  updated: string[];
  skipped: string[];
  error?: string;
}

export interface ConsolidateGlossaryResult {
  annotationsConsidered: number;
  proposed: number;
  /** Entries auto-accepted into live content (autoAccept mode only). */
  autoAccepted: number;
  /** Entries routed to profile overlays rather than the global glossary. */
  overlayEntries: number;
  skippedDuplicates: number;
  sections: string[];
  /** Rollback handle; null when the run made no changes. */
  batchId: string | null;
  /** Computed tier reassignment (auto-accept runs only). */
  retier?: RetierResult;
}

export interface RetierViewResult {
  /** null = the global view; else the variety profile whose overlays competed. */
  profileId: string | null;
  promoted: string[];
  demoted: string[];
  tier0Tokens: number;
  cap: number;
}

export interface RetierResult {
  views: RetierViewResult[];
}

export interface ConsolidateGlossaryOptions {
  /** Publish surviving entries immediately (the RSI mode) instead of queueing
   * proposals for human review. Safety = dedupe + Tier 0 cap + batch rollback. */
  autoAccept?: boolean;
  trigger?: 'manual' | 'scheduled';
  /** Skip the run (and its LLM call) below this many unconsumed annotations. */
  minAnnotations?: number;
}

/**
 * Language glossary lifecycle + seed job (LANGUAGE_GLOSSARY_DESIGN.md §6, §8).
 *
 * The Tier 0 token cap is enforced here at authoring time (publish AND edits to
 * already-published `always` sections) — runtime never truncates silently.
 */
@Injectable()
export class LanguageGlossaryService {
  private readonly logger = new Logger(LanguageGlossaryService.name);

  constructor(
    private readonly glossaryRepository: LanguageGlossaryRepository,
    private readonly languagesRepository: LanguagesRepository,
    @InjectRepository(Prompt)
    private readonly promptRepository: Repository<Prompt>,
    @InjectRepository(PromptVersion)
    private readonly promptVersionRepository: Repository<PromptVersion>,
    @InjectRepository(LanguageErrorAnnotation)
    private readonly annotationRepository: Repository<LanguageErrorAnnotation>,
    @InjectRepository(GlossaryConsolidationBatch)
    private readonly batchRepository: Repository<GlossaryConsolidationBatch>,
    @InjectRepository(VarietyProfileAttachment)
    private readonly attachmentRepository: Repository<VarietyProfileAttachment>,
    @InjectRepository(LanguageVarietyProfile)
    private readonly profileRepository: Repository<LanguageVarietyProfile>,
    private readonly llmProviderFactory: LlmProviderFactory,
    private readonly configService: AppConfigService,
  ) {}

  async listSections(languageId: number): Promise<GlossaryListResponse> {
    const sections =
      await this.glossaryRepository.findAllForLanguage(languageId);
    const views = sections.map((section) => ({
      section,
      compiledTokens: countGlossaryTokens(compileSection(section)),
    }));
    // The register policy is part of the served card, so it is part of the
    // budget. Counting the sections alone would let a publish pass a cap the
    // runtime card then exceeds — and this cap is documented as enforced at
    // authoring time and never truncated at runtime.
    const registerPolicy = await this.resolveRegisterPolicy(languageId);
    const tier0Tokens = countGlossaryTokens(
      compileTier0Glossary(sections, registerPolicy),
    );
    return { sections: views, tier0Tokens, tier0TokenCap: TIER0_TOKEN_CAP };
  }

  /**
   * Create or edit a section — global, or one variety profile's overlay.
   *
   * `profileId` exists because consolidation CREATES overlay sections
   * (`sectionCode` + `profileId`) while this method used to resolve the global
   * section only. The loop could therefore produce sections no authoring
   * endpoint could reach: found 2026-09-02 with 14 accepted-worthy Tamil rules
   * stuck behind a full Tier 0 budget in overlay sections whose tier nobody
   * could change by hand. Omit it for the global section, as before.
   */
  async upsertSection(
    languageId: number,
    sectionCode: string,
    dto: UpsertGlossarySectionDto,
    updatedBy?: string,
    profileId?: string | null,
  ): Promise<LanguageGlossarySection> {
    await this.assertLanguageExists(languageId);
    const existing = await this.glossaryRepository.findSection(
      languageId,
      sectionCode,
      profileId ?? null,
    );

    // A manual injectionMode change pins the tier: the admin's explicit
    // choice must survive the computed re-tiering pass. Explicit
    // dto.tierPinned always wins (false = hand the section back to the pass).
    const modeChangedByHand =
      existing && dto.injectionMode !== existing.injectionMode;
    const tierPinned =
      dto.tierPinned ?? (modeChangedByHand || existing?.tierPinned || false);

    const candidate = this.glossaryRepository.create({
      ...(existing ?? {
        languageId,
        sectionCode,
        profileId: profileId ?? null,
        status: GlossarySectionStatus.DRAFT,
        createdBy: updatedBy,
      }),
      title: dto.title,
      content: dto.content,
      retrievalHint: dto.retrievalHint,
      injectionMode: dto.injectionMode,
      importance: dto.importance,
      tierPinned,
      version: (existing?.version ?? 0) + 1,
      updatedBy,
    });

    // Editing a published always-section can grow the live Tier 0 block, so
    // the cap applies to edits too, not just the publish transition.
    if (
      candidate.status === GlossarySectionStatus.PUBLISHED &&
      candidate.injectionMode === GlossaryInjectionMode.ALWAYS
    ) {
      await this.assertTier0WithinCap(languageId, candidate);
    }

    return this.glossaryRepository.save(candidate);
  }

  async publishSection(
    languageId: number,
    sectionCode: string,
    updatedBy?: string,
    profileId?: string | null,
  ): Promise<LanguageGlossarySection> {
    const section = await this.getSectionOrThrow(
      languageId,
      sectionCode,
      profileId,
    );
    if (section.injectionMode === GlossaryInjectionMode.ALWAYS) {
      await this.assertTier0WithinCap(languageId, {
        ...section,
        status: GlossarySectionStatus.PUBLISHED,
      } as LanguageGlossarySection);
    }
    section.status = GlossarySectionStatus.PUBLISHED;
    section.updatedBy = updatedBy;
    return this.glossaryRepository.save(section);
  }

  async archiveSection(
    languageId: number,
    sectionCode: string,
    updatedBy?: string,
    profileId?: string | null,
  ): Promise<LanguageGlossarySection> {
    const section = await this.getSectionOrThrow(
      languageId,
      sectionCode,
      profileId,
    );
    section.status = GlossarySectionStatus.ARCHIVED;
    section.updatedBy = updatedBy;
    return this.glossaryRepository.save(section);
  }

  /**
   * The derived `## Register` block for a language, and the tenant's variety
   * profile when attached.
   *
   * This is the phase 1 fix (design §14): the agent's register instruction and
   * the judge's grading target now come from ONE expression. When a tenant is
   * attached to a variety profile the descriptor carries that profile's
   * measured features — address-form share and code-mix level — so the
   * instruction is grounded in what that tenant's learners actually say rather
   * than in a seeded string.
   *
   * Never throws: a language row that cannot be read costs the register line,
   * not the glossary.
   */
  async resolveRegisterPolicy(
    languageId: number,
    profileId?: string | null,
  ): Promise<string> {
    try {
      const language = await this.languagesRepository.findOne({
        where: { id: languageId },
      });
      if (!language) return '';
      const base = resolveTargetVariety(
        language.evalConfig as Record<string, unknown> | null,
        language.label,
      );
      let descriptor = base;
      if (profileId) {
        const profile = await this.profileRepository.findOne({
          where: { id: profileId },
        });
        if (profile && profile.status !== VarietyProfileStatus.ARCHIVED) {
          descriptor = varietyTargetDescriptor(base, profile.features);
        }
      }
      return compileRegisterPolicy(descriptor);
    } catch (error) {
      this.logger.warn(
        `[GLOSSARY] register policy resolution failed for language ${languageId}: ${error}`,
      );
      return '';
    }
  }

  /**
   * Compiled Tier 0 style card — global + the profile's overlays when given,
   * led by the derived register policy.
   *
   * The policy is resolved here rather than passed in by callers on purpose:
   * every reader of the Tier 0 card wants the same register instruction, and a
   * parameter would let one call site quietly serve a card without it. That is
   * how the instruction drifted from the grading target in the first place.
   */
  async resolveTier0Glossary(
    languageId: number,
    profileId?: string | null,
  ): Promise<string> {
    const [sections, registerPolicy] = await Promise.all([
      this.glossaryRepository.findPublishedByLanguage(
        languageId,
        GlossaryInjectionMode.ALWAYS,
        profileId,
      ),
      this.resolveRegisterPolicy(languageId, profileId),
    ]);
    return compileTier0Glossary(sections, registerPolicy);
  }

  /**
   * Tier 1: published `retrieved` sections compiled to text, for the live
   * agent's knowledge-retrieval title selection (Phase 5). `retrievalHint`
   * tells the selector when to pull a section — glossary sections are
   * production resources (what the NEXT reply needs), not discussion topics.
   */
  async resolveTier1Sections(
    languageId: number,
    profileId?: string | null,
  ): Promise<
    {
      title: string;
      content: string;
      retrievalHint?: string;
      sectionCode: string;
    }[]
  > {
    const sections = await this.glossaryRepository.findPublishedByLanguage(
      languageId,
      GlossaryInjectionMode.RETRIEVED,
      profileId,
    );
    return sections
      .map((section) => ({
        title: section.title,
        content: compileSection(section),
        retrievalHint: section.retrievalHint ?? undefined,
        // Stable analytics key: title edits don't break per-section hit-rate
        // joins, and it matches glossaryMeta.versions' keys.
        sectionCode: section.sectionCode,
      }))
      .filter((s) => s.content.length > 0);
  }

  /**
   * Glossary provenance for session analytics: the published section
   * versions a session is being served (both tiers) plus the compiled
   * Tier 0 token cost. Stamped into room metadata at session start and
   * echoed back by the worker through start_metrics, so judge deltas can
   * be grouped by the exact glossary a session ran with instead of by
   * publish date. Null when the language has nothing published.
   */
  async resolveGlossaryMeta(
    languageId: number,
    profileId?: string | null,
  ): Promise<{
    versions: Record<string, number>;
    tier0Tokens: number;
    profileId?: string;
  } | null> {
    const sections = await this.glossaryRepository.findPublishedByLanguage(
      languageId,
      undefined,
      profileId,
    );
    if (sections.length === 0) return null;
    const versions: Record<string, number> = {};
    for (const section of sections) {
      // Overlay-scoped keys so provenance distinguishes which view served.
      const key = section.profileId
        ? `${section.sectionCode}@${section.profileId}`
        : section.sectionCode;
      versions[key] = section.version;
    }
    const registerPolicy = await this.resolveRegisterPolicy(
      languageId,
      profileId,
    );
    return {
      versions,
      tier0Tokens: countGlossaryTokens(
        compileTier0Glossary(sections, registerPolicy),
      ),
      ...(profileId ? { profileId } : {}),
    };
  }

  /**
   * Seed job (GL-5): generate a draft glossary for a language via the
   * `glossary_generation` registry prompt. Published sections are never
   * overwritten — drafts only. Returns per-section outcomes.
   */
  async generateDraftGlossary(
    languageId: number,
    createdBy?: string,
  ): Promise<{ created: string[]; updated: string[]; skipped: string[] }> {
    const language = await this.assertLanguageExists(languageId);
    const { systemPrompt, engine } = await this.resolvePromptByCode(
      GLOSSARY_GENERATION_PROMPT_CODE,
    );

    const filled = systemPrompt
      .split('{{languageName}}')
      .join(language.label)
      .split('{{languageCode}}')
      .join(language.value)
      .split('{{evalConfig}}')
      .join(JSON.stringify(language.evalConfig ?? {}));

    const provider = this.llmProviderFactory.getProvider(engine.provider);
    const raw = await provider.getCompletion(
      [
        { role: 'system', content: filled },
        {
          role: 'user',
          content: `Generate the draft glossary for ${language.label} (${language.value}).`,
        },
      ],
      {
        model: engine.model,
        temperature: engine.temperature,
        maxTokens: engine.maxTokens,
      },
    );

    const generated = this.parseGeneratedSections(raw);
    const created: string[] = [];
    const updated: string[] = [];
    const skipped: string[] = [];

    // Seed content is held to the same evidence standard as consolidation
    // (the Kannada ಆದரೆ incident: a seeded avoid-term the population itself
    // uses). Score every parsed say/avoid line against the real corpora and
    // record verdicts in provenance so a reviewer sees contradicted lines
    // BEFORE publishing. Best-effort: no corpora (new language) = no verdicts.
    const corpora = await this.fetchEvidenceCorpora(language.value, null).catch(
      () => null,
    );
    let contradictedLines = 0;

    for (const gen of generated) {
      const existing = await this.glossaryRepository.findSection(
        languageId,
        gen.sectionCode,
      );
      if (existing && existing.status === GlossarySectionStatus.PUBLISHED) {
        skipped.push(gen.sectionCode);
        continue;
      }

      let seedEvidence:
        | { line: string; verdict: string; avoidLearnerCount: number }[]
        | undefined;
      if (corpora) {
        seedEvidence = [];
        for (const line of (gen.content ?? '').split('\n')) {
          const evidence = scoreLexicalEvidence(
            line,
            corpora.learner,
            corpora.agent,
            GLOSSARY_LEXICAL_CONTRADICTION_MIN,
          );
          if (!evidence || !evidence.avoid) continue;
          seedEvidence.push({
            line: line.trim().slice(0, 200),
            verdict: evidence.verdict,
            avoidLearnerCount: evidence.avoidLearnerCount,
          });
          if (evidence.verdict === 'contradicted') contradictedLines++;
        }
        if (seedEvidence.length === 0) seedEvidence = undefined;
      }

      const section = this.glossaryRepository.create({
        ...(existing ?? {
          languageId,
          sectionCode: gen.sectionCode,
          createdBy,
        }),
        title: gen.title,
        content: gen.content,
        retrievalHint: gen.retrievalHint,
        injectionMode:
          gen.injectionMode === GlossaryInjectionMode.ALWAYS
            ? GlossaryInjectionMode.ALWAYS
            : GlossaryInjectionMode.RETRIEVED,
        status: GlossarySectionStatus.DRAFT,
        provenance: {
          source: 'seed',
          ...(seedEvidence ? { seedEvidence } : {}),
        },
        version: (existing?.version ?? 0) + 1,
        updatedBy: createdBy,
      });
      await this.glossaryRepository.save(section);
      (existing ? updated : created).push(gen.sectionCode);
    }

    if (contradictedLines > 0) {
      this.logger.warn(
        `[GLOSSARY_SEED] language=${language.value} ${contradictedLines} seeded ` +
          `avoid-line(s) CONTRADICTED by the learner corpus — review before publishing ` +
          `(provenance.seedEvidence on the draft sections)`,
      );
    }
    this.logger.log(
      `[GLOSSARY_SEED] language=${language.value} created=${created.length} updated=${updated.length} skipped=${skipped.length} contradicted=${contradictedLines}`,
    );
    return { created, updated, skipped };
  }

  /**
   * Backfill (wave rollout): generate draft glossaries for many languages in
   * one action. Defaults to every active non-English language; per-language
   * failures are recorded, never thrown. Sequential — one Gemini call each.
   */
  async backfillGlossaries(
    languageIds?: number[],
    createdBy?: string,
  ): Promise<BackfillGlossariesOutcome[]> {
    const languages = languageIds?.length
      ? await this.languagesRepository.find({ where: { id: In(languageIds) } })
      : (
          await this.languagesRepository.find({ where: { active: true } })
        ).filter((l) => !l.value.startsWith('en'));

    const outcomes: BackfillGlossariesOutcome[] = [];
    for (const language of languages) {
      try {
        const result = await this.generateDraftGlossary(language.id, createdBy);
        outcomes.push({
          languageId: language.id,
          value: language.value,
          ...result,
        });
      } catch (error) {
        outcomes.push({
          languageId: language.id,
          value: language.value,
          created: [],
          updated: [],
          skipped: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.logger.log(
      `[GLOSSARY_BACKFILL] languages=${outcomes.length} failed=${outcomes.filter((o) => o.error).length}`,
    );
    return outcomes;
  }

  /**
   * Consolidation loop (Phase 4, design §6.2 + RSI extension): cluster the
   * language judge's error annotations into glossary entries with provenance
   * back to the annotations they generalize.
   *
   * Routing: entries supported by exactly one variety profile's tenants land
   * in that profile's OVERLAY section (same sectionCode, profileId set);
   * entries with multi-profile or unattached support land in the global
   * section. Runtime serves global + the session profile's overlays.
   *
   * Modes: default queues entries as 'proposed' for human review. With
   * `autoAccept` (the RSI mode) surviving entries publish immediately —
   * safety comes from dedupe, the Tier 0 token cap, and the batch record,
   * which lets a regressing run be rolled back as a unit.
   *
   * Annotations already referenced by any entry's provenance are excluded
   * (consumed-set), so re-runs only see new failures.
   */
  async consolidateGlossary(
    languageId: number,
    createdBy?: string,
    options: ConsolidateGlossaryOptions = {},
  ): Promise<ConsolidateGlossaryResult> {
    const emptyResult: ConsolidateGlossaryResult = {
      annotationsConsidered: 0,
      proposed: 0,
      autoAccepted: 0,
      overlayEntries: 0,
      skippedDuplicates: 0,
      sections: [],
      batchId: null,
    };
    const language = await this.assertLanguageExists(languageId);
    const sections =
      await this.glossaryRepository.findAllForLanguage(languageId);

    const consumedIds = await this.collectConsumedAnnotationIds(
      languageId,
      sections,
    );
    const unconsumed = await this.unconsumedAnnotationsQuery(
      language.value,
      consumedIds,
    ).getMany();
    if (unconsumed.length === 0) return emptyResult;
    if (unconsumed.length < (options.minAnnotations ?? 0)) {
      this.logger.log(
        `[GLOSSARY_CONSOLIDATE] language=${language.value} skipped: ` +
          `${unconsumed.length} unconsumed annotations < min ${options.minAnnotations}`,
      );
      return { ...emptyResult, annotationsConsidered: unconsumed.length };
    }

    // Construct-class pipeline (linguistics proposes, statistics disposes):
    // grammar errors pass only the systematicity gate; everything is then
    // clustered by evidence similarity within (construct, category) and
    // clusters below the support floor never reach the LLM.
    const annotations = [
      ...unconsumed.filter((a) => a.dimension !== 'fluency'),
      ...systematicFluency(unconsumed, GLOSSARY_SYSTEMATIC_MIN),
    ];
    const clusters = applySupportGate(
      clusterAnnotations(annotations),
      annotations.length,
      GLOSSARY_MIN_CLUSTER_SUPPORT,
    );
    if (clusters.length === 0) {
      // Record the attempt even though it produced nothing. The scheduler's
      // cadence — both the weekly interval and the minimum gap — is measured
      // from the last batch, so a path that returns without writing one leaves
      // the clock frozen and re-runs on EVERY tick. Marathi and Kannada did
      // exactly that: 2026-09-02, both consolidating twice within 30 minutes
      // on a supposedly weekly cadence, because their unconsumed annotations
      // (1 and 3, all `fluency` below the systematicity bar) can never cluster.
      //
      // An empty batch is also the honest audit record: "ran, found nothing"
      // is what a reader needs to distinguish a quiet loop from a stalled one,
      // which is the exact ambiguity that hid the original stall for 8 days.
      const emptyBatch = await this.batchRepository.save(
        this.batchRepository.create({
          languageId,
          autoAccepted: Boolean(options.autoAccept),
          trigger: options.trigger ?? 'manual',
          createdBy,
          stats: {
            annotationsConsidered: annotations.length,
            tenants: 0,
            proposed: 0,
            autoAccepted: 0,
            skippedDuplicates: 0,
            overlayEntries: 0,
          },
          entries: [],
        }),
      );
      this.logger.log(
        `[GLOSSARY_CONSOLIDATE] language=${language.value} batch=${emptyBatch.id} skipped: ` +
          `${annotations.length} annotations formed no cluster above the support gate`,
      );
      return {
        ...emptyResult,
        annotationsConsidered: annotations.length,
        batchId: emptyBatch.id,
      };
    }

    const { systemPrompt, engine } = await this.resolvePromptByCode(
      GLOSSARY_CONSOLIDATION_PROMPT_CODE,
    );
    const filled = systemPrompt
      .split('{{languageName}}')
      .join(language.label)
      .split('{{languageCode}}')
      .join(language.value)
      .split('{{existingGlossary}}')
      .join(this.summarizeGlossary(sections))
      .split('{{annotations}}')
      .join(summarizeClusters(clusters, annotations));

    const provider = this.llmProviderFactory.getProvider(engine.provider);
    const raw = await provider.getCompletion(
      [
        { role: 'system', content: filled },
        {
          role: 'user',
          content: `Consolidate the ${annotations.length} annotations for ${language.label} (${language.value}).`,
        },
      ],
      {
        model: engine.model,
        temperature: engine.temperature,
        maxTokens: engine.maxTokens,
      },
    );

    const { sections: consolidated, engineeringFindings: rawFindings } =
      this.parseConsolidationOutput(raw);
    const profileByTenant = await this.buildTenantProfileMap(languageId);
    // Distinct variety profiles this language actually has tenants attached to
    // — the gate on whether overlay routing can mean anything (see `target`).
    const attachedProfileCount = new Set(
      [...profileByTenant.values()].filter(Boolean),
    ).size;
    // Distributional evidence corpora for the lexical gate, scoped to the
    // routing target: an overlay entry is judged against ITS population's
    // corpus (the profile's attached tenants), a global entry against every
    // non-test tenant — otherwise one population's usage vetoes another
    // population's correct rule. Best-effort; a fetch failure downgrades
    // entries to 'unverified', never blocks the run.
    const corporaCache = new Map<
      string | null,
      { learner: string; agent: string } | null
    >();
    const corporaFor = async (profileId: string | null) => {
      if (!corporaCache.has(profileId)) {
        corporaCache.set(
          profileId,
          await this.fetchEvidenceCorpora(language.value, profileId).catch(
            () => null,
          ),
        );
      }
      return corporaCache.get(profileId) ?? null;
    };

    // The batch row exists before its entries so their provenance can carry
    // the batch id (the rollback handle) from the moment they are written.
    const batch = await this.batchRepository.save(
      this.batchRepository.create({
        languageId,
        autoAccepted: Boolean(options.autoAccept),
        trigger: options.trigger ?? 'manual',
        createdBy,
      }),
    );

    let proposed = 0;
    let autoAccepted = 0;
    let overlayEntries = 0;
    let skippedDuplicates = 0;
    // Proposals that restate an ALREADY-PUBLISHED line. Recorded rather than
    // silently dropped: a dropped proposal never consumes its annotations, so
    // the same rule is re-derived from the same evidence and re-dropped on
    // every cycle, forever, while those rows occupy the bounded read window.
    // Recording them here consumes the evidence (batch findings are part of
    // the consumed-set) and leaves the collision visible — a published rule
    // that keeps re-deriving is a rule that is not working.
    const redundantFindings: { summary: string; annotationIds: string[] }[] =
      [];
    const touched: string[] = [];
    const batchEntries: ConsolidationBatchEntry[] = [];

    // One index for the whole language: proposals are routed per sectionCode
    // and per variety profile, so a per-section set let the same rule land
    // twice under different sections, or once globally and once as an overlay.
    const dedupe = new GlossaryDedupeIndex();
    for (const section of sections) {
      dedupe.addContent(section.content);
      for (const entry of section.entries ?? []) dedupe.add(entry.markdown);
    }

    for (const gen of consolidated) {
      // Route each proposal: overlay when every supporting tenant maps to the
      // SAME variety profile; global otherwise (multi-profile support means
      // the rule generalizes; unattached support means we can't scope it).
      const byTarget = new Map<
        string | null,
        { proposal: ConsolidatedProposal; annos: LanguageErrorAnnotation[] }[]
      >();
      for (const proposal of gen.proposals ?? []) {
        if (!proposal || typeof proposal.markdown !== 'string') continue;
        if (!proposal.markdown.trim()) continue;
        const annos = (proposal.sourceAnnotationIndexes ?? [])
          .map((i) => annotations[i - 1])
          .filter((a): a is LanguageErrorAnnotation => Boolean(a));
        const profiles = new Set(
          annos
            .map((a) => a.tenantId)
            .filter(Boolean)
            .map((t) => profileByTenant.get(t) ?? null),
        );
        const soleProfile = profiles.size === 1 ? [...profiles][0] : null;
        // Overlay routing needs CONTRAST to carry information. When the
        // language has fewer than two attached profiles, `profiles.size === 1`
        // is unavoidable — it reflects which tenants happen to send traffic,
        // not evidence that the rule is variety-specific — so an overlay would
        // make a universal rule private to one org.
        //
        // Measured 2026-09-03: Tamil was the only language with a profile, it
        // had exactly one, and 65% of its published glossary had accordingly
        // been routed into that org's overlay — including plainly universal
        // Tamil grammar (accusative case marking, the locative suffix). A
        // second Tamil tenant would have inherited none of it, and the global
        // glossary could never grow, because every rule the language learned
        // was routed away from it.
        //
        // With two or more profiles the single-profile signal IS meaningful:
        // the other populations existed and did not produce the error.
        const target = attachedProfileCount >= 2 ? (soleProfile ?? null) : null;
        const bucket = byTarget.get(target) ?? [];
        bucket.push({ proposal, annos });
        byTarget.set(target, bucket);
      }

      for (const [profileId, bucket] of byTarget) {
        const existing = await this.glossaryRepository.findSection(
          languageId,
          gen.sectionCode,
          profileId,
        );
        // Overlay sections inherit their shape from the global counterpart
        // when one exists — the overlay overrides it at runtime, so diverging
        // titles/hints would just confuse retrieval.
        const globalCounterpart = profileId
          ? (existing ??
            (await this.glossaryRepository.findSection(
              languageId,
              gen.sectionCode,
            )))
          : existing;
        const section =
          existing ??
          this.glossaryRepository.create({
            languageId,
            sectionCode: gen.sectionCode,
            profileId,
            title:
              globalCounterpart?.title ||
              gen.title ||
              gen.sectionCode.replace(/_/g, ' '),
            content: profileId ? (globalCounterpart?.content ?? '') : '',
            entries: [],
            retrievalHint:
              globalCounterpart?.retrievalHint ?? gen.retrievalHint,
            injectionMode: globalCounterpart
              ? globalCounterpart.injectionMode
              : gen.injectionMode === GlossaryInjectionMode.ALWAYS
                ? GlossaryInjectionMode.ALWAYS
                : GlossaryInjectionMode.RETRIEVED,
            status: GlossarySectionStatus.DRAFT,
            provenance: { source: 'consolidation' },
            createdBy,
          });

        // A section created in THIS run isn't in `sections`, and an overlay
        // seeds its content from the global counterpart — fold both in so the
        // index covers what this bucket is actually writing into.
        dedupe.addContent(section.content);
        for (const entry of section.entries ?? []) dedupe.add(entry.markdown);

        const corpora = await corporaFor(profileId ?? null);
        const newEntryIds: string[] = [];
        for (const { proposal, annos } of bucket) {
          const markdown = proposal.markdown.trim();
          const annotationIds = annos.map((a) => a.id);
          const duplicate = dedupe.duplicateOf(markdown);
          if (duplicate) {
            skippedDuplicates++;
            // A queued sibling is still undecided, and whichever lands
            // consumes the evidence — dropping is correct there. A published
            // match is the deadlock case.
            if (duplicate.source === 'published' && annotationIds.length > 0) {
              redundantFindings.push({
                summary: (
                  `Re-derived an already-published rule, so the published one ` +
                  `is not preventing these errors. Proposed: ` +
                  `"${markdown.slice(0, 160)}" — already published: ` +
                  `"${duplicate.line.slice(0, 160)}"`
                ).slice(0, 500),
                annotationIds,
              });
            }
            continue;
          }
          dedupe.add(markdown);
          const tenantIds = [
            ...new Set(annos.map((a) => a.tenantId).filter(Boolean)),
          ];
          // Statistics disposes: lexicon entries are scored against the real
          // corpora. 'contradicted' entries (the population itself uses the
          // avoid-term) are never auto-accepted.
          const evidence = corpora
            ? scoreLexicalEvidence(
                markdown,
                corpora.learner,
                corpora.agent,
                GLOSSARY_LEXICAL_CONTRADICTION_MIN,
              )
            : null;
          const entryId = randomUUID();
          section.entries = [
            ...(section.entries ?? []),
            {
              id: entryId,
              markdown,
              status: GlossaryEntryStatus.PROPOSED,
              importance: this.clampImportance(proposal.importance),
              provenance: {
                source: 'consolidation',
                annotationIds,
                tenantIds,
                batchId: batch.id,
                ...(evidence ? { evidence } : {}),
              },
            },
          ];
          newEntryIds.push(entryId);
          if (profileId) overlayEntries++;
        }

        if (newEntryIds.length === 0) continue;

        let acceptedHere = 0;
        if (options.autoAccept && newEntryIds.length > 0) {
          acceptedHere = await this.autoAcceptEntries(
            languageId,
            section,
            newEntryIds,
          );
          autoAccepted += acceptedHere;
        }

        section.version = (existing?.version ?? 0) + 1;
        section.updatedBy = createdBy;
        const saved = await this.glossaryRepository.save(section);
        touched.push(
          profileId ? `${gen.sectionCode}@${profileId}` : gen.sectionCode,
        );
        proposed += newEntryIds.length;
        for (const entryId of newEntryIds) {
          const entry = (saved.entries ?? []).find((e) => e.id === entryId);
          if (!entry) continue;
          batchEntries.push({
            sectionId: saved.id,
            sectionCode: saved.sectionCode,
            profileId: profileId ?? null,
            entryId,
            markdown: entry.markdown,
            accepted: entry.status === GlossaryEntryStatus.ACCEPTED,
          });
        }
      }
    }

    // Production-artifact clusters land on the batch as engineering findings
    // (v3 prompt contract) — visible to engineers, never glossary content.
    const engineeringFindings = [
      ...rawFindings.map((f) => ({
        summary: f.summary.slice(0, 500),
        annotationIds: (f.sourceAnnotationIndexes ?? [])
          .map((i) => annotations[i - 1]?.id)
          .filter((id): id is string => Boolean(id)),
      })),
      ...redundantFindings,
    ];

    const distinctTenants = new Set(
      annotations.map((a) => a.tenantId).filter(Boolean),
    ).size;
    batch.entries = batchEntries;
    batch.stats = {
      annotationsConsidered: annotations.length,
      tenants: distinctTenants,
      proposed,
      autoAccepted,
      skippedDuplicates,
      overlayEntries,
      ...(engineeringFindings.length ? { engineeringFindings } : {}),
    };
    await this.batchRepository.save(batch);

    this.logger.log(
      `[GLOSSARY_CONSOLIDATE] language=${language.value} batch=${batch.id} ` +
        `annotations=${annotations.length} tenants=${distinctTenants} ` +
        `proposed=${proposed} autoAccepted=${autoAccepted} overlays=${overlayEntries} ` +
        `duplicates=${skippedDuplicates} engFindings=${engineeringFindings.length} sections=${touched.join(',')}`,
    );
    // The cycle's final stage in auto mode: recompute tier assignment now
    // that new entries are live. Best-effort — a retier failure never fails
    // the consolidation that preceded it.
    let retier: RetierResult | undefined;
    if (options.autoAccept && autoAccepted > 0) {
      try {
        retier = await this.retierGlossary(languageId, { apply: true });
      } catch (error) {
        this.logger.warn(
          `[GLOSSARY_RETIER] skipped after consolidation for language ${languageId}: ${error}`,
        );
      }
    }

    return {
      annotationsConsidered: annotations.length,
      proposed,
      autoAccepted,
      overlayEntries,
      skippedDuplicates,
      sections: touched,
      batchId:
        batchEntries.length > 0 || engineeringFindings.length > 0
          ? batch.id
          : null,
      ...(retier ? { retier } : {}),
    };
  }

  /**
   * RSI-mode acceptance: fold the given proposed entries into the section's
   * live content and publish. All-or-nothing per section: if the grown Tier 0
   * block would exceed the cap, every entry stays 'proposed' for human review
   * instead (never partially publish a run's entries — rollback and review
   * both reason about whole sections).
   */
  private async autoAcceptEntries(
    languageId: number,
    section: LanguageGlossarySection,
    entryIds: string[],
  ): Promise<number> {
    // Corpus-contradicted entries stay proposed for human eyes — the RSI mode
    // never publishes a rule the population's own usage argues against.
    const entries = (section.entries ?? []).filter(
      (e) =>
        entryIds.includes(e.id) &&
        e.provenance?.evidence?.verdict !== 'contradicted',
    );
    if (entries.length === 0) return 0;
    const grownContent = [
      (section.content ?? '').trimEnd(),
      ...entries.map((e) => e.markdown),
    ]
      .filter(Boolean)
      .join('\n');
    const candidate = {
      ...section,
      content: grownContent,
      status: GlossarySectionStatus.PUBLISHED,
    } as LanguageGlossarySection;
    if (candidate.injectionMode === GlossaryInjectionMode.ALWAYS) {
      try {
        await this.assertTier0WithinCap(languageId, candidate);
      } catch (error) {
        this.logger.warn(
          `[GLOSSARY_CONSOLIDATE] auto-accept skipped for '${section.sectionCode}'` +
            `${section.profileId ? `@${section.profileId}` : ''}: ${error}`,
        );
        return 0;
      }
    }
    section.content = grownContent;
    section.status = GlossarySectionStatus.PUBLISHED;
    for (const entry of entries) {
      entry.status = GlossaryEntryStatus.ACCEPTED;
    }
    return entries.length;
  }

  /**
   * Undo one consolidation run: remove its accepted lines from section
   * content and flip its entries to 'rejected' — which keeps their
   * annotations in the consumed-set, so a rolled-back rule is a rejected
   * rule, not one the next run rediscovers.
   */
  async rollbackConsolidationBatch(
    languageId: number,
    batchId: string,
    updatedBy?: string,
  ): Promise<{ batchId: string; sections: string[]; rolledBack: number }> {
    const batch = await this.batchRepository.findOne({
      where: { id: batchId, languageId },
    });
    if (!batch) {
      throw new NotFoundException(
        `Consolidation batch ${batchId} not found for language ${languageId}`,
      );
    }
    if (batch.status === ConsolidationBatchStatus.ROLLED_BACK) {
      throw new BadRequestException(`Batch ${batchId} is already rolled back`);
    }

    const bySection = new Map<string, ConsolidationBatchEntry[]>();
    for (const entry of batch.entries ?? []) {
      const list = bySection.get(entry.sectionId) ?? [];
      list.push(entry);
      bySection.set(entry.sectionId, list);
    }

    let rolledBack = 0;
    const sections: string[] = [];
    for (const [sectionId, entries] of bySection) {
      const section = await this.glossaryRepository.findOne({
        where: { id: sectionId },
      });
      if (!section) continue;
      let lines = (section.content ?? '').split('\n');
      for (const batchEntry of entries) {
        if (batchEntry.accepted) {
          const needle = normalizeMarkdown(batchEntry.markdown);
          const idx = lines.findIndex(
            (line) => normalizeMarkdown(line) === needle,
          );
          if (idx >= 0) lines = lines.filter((_, i) => i !== idx);
        }
        const entry = (section.entries ?? []).find(
          (e) => e.id === batchEntry.entryId,
        );
        if (entry && entry.status !== GlossaryEntryStatus.REJECTED) {
          entry.status = GlossaryEntryStatus.REJECTED;
          rolledBack++;
        }
      }
      section.content = lines.join('\n').trim();
      section.version += 1;
      section.updatedBy = updatedBy;
      await this.glossaryRepository.save(section);
      sections.push(
        section.profileId
          ? `${section.sectionCode}@${section.profileId}`
          : section.sectionCode,
      );
    }

    batch.status = ConsolidationBatchStatus.ROLLED_BACK;
    await this.batchRepository.save(batch);
    this.logger.log(
      `[GLOSSARY_ROLLBACK] language=${languageId} batch=${batchId} entries=${rolledBack} sections=${sections.join(',')}`,
    );
    return { batchId, sections, rolledBack };
  }

  async listConsolidationBatches(
    languageId: number,
  ): Promise<GlossaryConsolidationBatch[]> {
    return this.batchRepository.find({
      where: { languageId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  /**
   * The consumed-set: annotations an existing entry already generalizes, plus
   * those reported as an engineering finding. Both consume — a rule's
   * provenance and a reported production artifact must not be re-mined next
   * cycle. Shared by the run and the scheduler's gate so the gate counts what
   * the run will actually see (they disagreed before: the gate ignored
   * engineering findings and reported 106 unconsumed English annotations for a
   * run that then saw 6).
   */
  private async collectConsumedAnnotationIds(
    languageId: number,
    sections?: LanguageGlossarySection[],
  ): Promise<string[]> {
    const resolved =
      sections ??
      (await this.glossaryRepository.findAllForLanguage(languageId));
    const consumed = new Set<string>();
    for (const section of resolved) {
      for (const entry of section.entries ?? []) {
        for (const annotationId of entry.provenance?.annotationIds ?? []) {
          consumed.add(annotationId as string);
        }
      }
    }
    const recentBatches = await this.batchRepository.find({
      where: { languageId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    for (const b of recentBatches) {
      for (const finding of b.stats?.engineeringFindings ?? []) {
        for (const id of finding.annotationIds ?? []) consumed.add(id);
      }
    }
    return [...consumed];
  }

  /**
   * The consolidation read: the most recent UNCONSUMED style annotations from
   * real tenants.
   *
   * Cross-tenant by design — the glossary is global per language, so it learns
   * from every REAL tenant's judged sessions. Internal/demo/QA orgs
   * (tenants.isTestOrganization) are excluded: measured 2026-08-20, test
   * traffic was >50% of the Kannada style-annotation pool, so an unfiltered
   * read learns style rules from our own testers, not the population.
   *
   * The consumed-set is excluded in SQL, BEFORE the limit. Applying the cap to
   * the most recent rows and dropping consumed ones afterwards let consumed
   * rows spend the whole budget: measured 2026-09-02, Tamil's window exposed
   * 13 of its 2,409 unconsumed annotations (1,675 of the hidden ones
   * non-fluency, i.e. immediately usable) and scheduled consolidation had
   * produced nothing for 8 days across every language.
   *
   * Bounded to GLOSSARY_CONSOLIDATION_RECENCY_DAYS: a rule reaches the agent's
   * every-turn prompt, so it must generalize the agent we ship now, not one
   * retired two models ago. See that constant for the measurement.
   */
  private unconsumedAnnotationsQuery(
    languageValue: string,
    consumedIds: string[],
  ): SelectQueryBuilder<LanguageErrorAnnotation> {
    const query = this.annotationRepository
      .createQueryBuilder('a')
      .where('a.language = :language', { language: languageValue })
      .andWhere('a.dimension IN (:...dimensions)', {
        dimensions: [...GLOSSARY_CONSOLIDATION_DIMENSIONS],
      })
      .andWhere('a.conditionedOut = false')
      .andWhere('a.occurredAt > now() - make_interval(days => :recencyDays)', {
        recencyDays: GLOSSARY_CONSOLIDATION_RECENCY_DAYS,
      })
      .andWhere(excludeTestTenants('a."tenant_id"'));
    // Evidence in a foreign script is not evidence about THIS language's
    // lexicon — it records the agent drifting into another language. Filtered
    // in SQL, before the row limit, for the same reason the consumed-set is:
    // otherwise unusable rows spend the budget.
    const foreignScript = excludeForeignScripts('a."aiText"', languageValue);
    if (foreignScript) query.andWhere(foreignScript);
    // Skipped when empty: `<> ALL('{}')` is true for every row, but an empty
    // array parameter gives Postgres no element type to infer.
    if (consumedIds.length > 0) {
      query.andWhere('a.id::text <> ALL(:consumedIds)', { consumedIds });
    }
    return query
      .orderBy('a.occurredAt', 'DESC')
      .take(GLOSSARY_CONSOLIDATION_ANNOTATION_LIMIT);
  }

  /** Unconsumed non-test style annotations — the scheduler's data-threshold gate. */
  async countUnconsumedAnnotations(languageId: number): Promise<number> {
    const language = await this.assertLanguageExists(languageId);
    const consumedIds = await this.collectConsumedAnnotationIds(languageId);
    const rows = await this.unconsumedAnnotationsQuery(
      language.value,
      consumedIds,
    )
      .select('a.id')
      .getMany();
    return rows.length;
  }

  /**
   * The computed tier pass (every-turn vs on-demand): rank each published
   * section by value density — term traffic in the live corpus plus
   * severity-weighted error mass behind its rules, per token — and let
   * Tier 0 be the knapsack prefix that fits the cap. Pinned sections are
   * untouchable; a hysteresis band prevents cycle-to-cycle flapping.
   *
   * Views are assigned independently: the global view first (its always-set
   * is shared by everyone), then each profile's overlays compete for the
   * budget the global always-set leaves.
   */
  async retierGlossary(
    languageId: number,
    options: { apply?: boolean } = {},
  ): Promise<RetierResult> {
    const apply = options.apply !== false;
    const language = await this.assertLanguageExists(languageId);
    const all = await this.glossaryRepository.findAllForLanguage(languageId);
    const published = all.filter(
      (s) => s.status === GlossarySectionStatus.PUBLISHED,
    );
    if (published.length === 0) return { views: [] };

    // Severity lookup for every accepted entry's source annotations, one query.
    const annotationIds = [
      ...new Set(
        published.flatMap((s) =>
          (s.entries ?? [])
            .filter((e) => e.status === GlossaryEntryStatus.ACCEPTED)
            .flatMap((e) => e.provenance?.annotationIds ?? []),
        ),
      ),
    ];
    const severityById = new Map<string, string>();
    if (annotationIds.length > 0) {
      const rows: { id: string; severity: string }[] =
        await this.annotationRepository.manager.query(
          `SELECT id, severity FROM language_error_annotations WHERE id = ANY($1::uuid[])`,
          [annotationIds],
        );
      for (const row of rows) severityById.set(row.id, row.severity);
    }

    const errorMassOf = (section: LanguageGlossarySection): number =>
      (section.entries ?? [])
        .filter((e) => e.status === GlossaryEntryStatus.ACCEPTED)
        .flatMap((e) => e.provenance?.annotationIds ?? [])
        .reduce(
          (sum, id) =>
            sum + (TIER_SEVERITY_WEIGHTS[severityById.get(id) ?? ''] ?? 1),
          0,
        );

    const usageOf = (
      section: LanguageGlossarySection,
      corpus: string,
    ): number => {
      // Format-agnostic term traffic: prod content mixes `- english: தமிழ்`
      // lines, backticked forms and say/avoid pairs, so parse nothing —
      // score every native-script token the section teaches by its frequency
      // in live speech. (First prod dry-run demoted pronouns_kinship, the
      // most-trafficked section, because its content had no quoted pairs.)
      const terms = new Set<string>();
      for (const token of tokenize(section.content ?? '')) {
        if (/^[a-z]+$/.test(token)) continue; // English scaffolding words
        if (token.length < 2) continue;
        terms.add(token);
        if (terms.size >= 80) break; // bound the scan for huge sections
      }
      let usage = 0;
      for (const term of terms) usage += countOccurrences(corpus, term);
      return usage;
    };

    const toCandidate = (
      section: LanguageGlossarySection,
      corpus: string,
    ): TierCandidate => ({
      key: section.profileId
        ? `${section.sectionCode}@${section.profileId}`
        : section.sectionCode,
      tokens: countGlossaryTokens(compileSection(section)),
      score:
        usageOf(section, corpus) +
        TIER_ERROR_MASS_WEIGHT * errorMassOf(section),
      pinned: section.tierPinned === true,
      currentMode:
        section.injectionMode === GlossaryInjectionMode.ALWAYS
          ? 'always'
          : 'retrieved',
    });

    const applyAssignment = async (
      sections: LanguageGlossarySection[],
      assignment: TierAssignment,
    ) => {
      if (!apply) return;
      for (const change of assignment.changes) {
        const section = sections.find(
          (s) =>
            (s.profileId
              ? `${s.sectionCode}@${s.profileId}`
              : s.sectionCode) === change.key,
        );
        if (!section) continue;
        section.injectionMode =
          change.to === 'always'
            ? GlossaryInjectionMode.ALWAYS
            : GlossaryInjectionMode.RETRIEVED;
        section.version += 1;
        section.updatedBy = 'retier';
        await this.glossaryRepository.save(section);
      }
    };

    const views: RetierViewResult[] = [];

    // Global view first — its always-set is every session's baseline.
    const globalSections = published.filter((s) => !s.profileId);
    const globalCorpus = (await this.fetchEvidenceCorpora(
      language.value,
      null,
    ).catch(() => null)) ?? { learner: '', agent: '' };
    const globalCombined = `${globalCorpus.learner}\n${globalCorpus.agent}`;
    const globalAssignment = computeTierAssignment(
      globalSections.map((s) => toCandidate(s, globalCombined)),
      TIER0_TOKEN_CAP,
      TIER_HYSTERESIS,
    );
    await applyAssignment(globalSections, globalAssignment);
    views.push({
      profileId: null,
      promoted: globalAssignment.changes
        .filter((c) => c.to === 'always')
        .map((c) => c.key),
      demoted: globalAssignment.changes
        .filter((c) => c.to === 'retrieved')
        .map((c) => c.key),
      tier0Tokens: globalAssignment.tier0Tokens,
      cap: TIER0_TOKEN_CAP,
    });

    // Each profile's overlays compete for what the global always-set leaves.
    const overlayBudget = Math.max(
      0,
      TIER0_TOKEN_CAP - globalAssignment.tier0Tokens,
    );
    const profileIds = [
      ...new Set(
        published.map((s) => s.profileId).filter((p): p is string => !!p),
      ),
    ];
    for (const profileId of profileIds) {
      const overlays = published.filter((s) => s.profileId === profileId);
      const corpus = (await this.fetchEvidenceCorpora(
        language.value,
        profileId,
      ).catch(() => null)) ?? { learner: '', agent: '' };
      const combined = `${corpus.learner}\n${corpus.agent}`;
      const assignment = computeTierAssignment(
        overlays.map((s) => toCandidate(s, combined)),
        overlayBudget,
        TIER_HYSTERESIS,
      );
      await applyAssignment(overlays, assignment);
      views.push({
        profileId,
        promoted: assignment.changes
          .filter((c) => c.to === 'always')
          .map((c) => c.key),
        demoted: assignment.changes
          .filter((c) => c.to === 'retrieved')
          .map((c) => c.key),
        tier0Tokens: assignment.tier0Tokens,
        cap: overlayBudget,
      });
    }

    const totalChanges = views.reduce(
      (sum, v) => sum + v.promoted.length + v.demoted.length,
      0,
    );
    this.logger.log(
      `[GLOSSARY_RETIER] language=${language.value} apply=${apply} changes=${totalChanges} ` +
        views
          .map(
            (v) =>
              `${v.profileId ?? 'global'}:+[${v.promoted.join(',')}]-[${v.demoted.join(',')}]`,
          )
          .join(' '),
    );
    return { views };
  }

  /**
   * Evidence corpora for the lexical gate: learner (senderId > 0) and agent
   * (senderId = -1) text from the language's judged sessions, non-test
   * tenants, 90 days, NFC-normalized and concatenated for substring counting.
   * With a profileId, the corpus narrows to that profile's attached tenants —
   * overlay entries are judged against THEIR population's usage, not the
   * whole language's (dual-key tenant match, id-as-text or code).
   */
  private async fetchEvidenceCorpora(
    languageValue: string,
    profileId: string | null = null,
  ): Promise<{ learner: string; agent: string } | null> {
    const profileScope = profileId
      ? `AND (ljs."tenant_id" IN (
             SELECT a."tenantId" FROM variety_profile_attachments a
              WHERE a."profileId" = $2)
         OR ljs."tenant_id" IN (
             SELECT t.code FROM tenants t
              JOIN variety_profile_attachments a ON a."tenantId" = t.id::text
              WHERE a."profileId" = $2)
         OR ljs."tenant_id" IN (
             SELECT t.id::text FROM tenants t
              JOIN variety_profile_attachments a ON a."tenantId" = t.code
              WHERE a."profileId" = $2))`
      : '';
    const rows: { content: string; senderId: number }[] =
      await this.annotationRepository.manager.query(
        `SELECT m.content, m."senderId"
           FROM scenario_session_messages m
          WHERE m."scenarioSessionId" IN (
                SELECT DISTINCT ljs."scenarioSessionId"
                  FROM language_judgment_sessions ljs
                 WHERE ljs.language = $1
                   AND ljs."createdAt" > now() - interval '90 days'
                   AND ${excludeTestTenants('ljs."tenant_id"')}
                   ${profileScope})
          ORDER BY m."createdAt" DESC
          LIMIT 40000`,
        profileId ? [languageValue, profileId] : [languageValue],
      );
    if (rows.length === 0) return null;
    const learner: string[] = [];
    const agent: string[] = [];
    for (const row of rows) {
      const text = (row.content ?? '').normalize('NFC');
      if (!text) continue;
      if (row.senderId > 0) learner.push(text);
      else agent.push(text);
    }
    return { learner: learner.join('\n'), agent: agent.join('\n') };
  }

  /** Languages (ids) with recent style annotations — the scheduler's worklist. */
  async queryCandidateLanguages(
    dimensions: string[],
  ): Promise<{ id: number }[]> {
    return this.annotationRepository.manager.query(
      `SELECT DISTINCT l.id
         FROM language_error_annotations a
         JOIN languages l ON l.value = a.language
        WHERE a.dimension = ANY($1)
          AND a."conditionedOut" = false
          AND a."occurredAt" > now() - interval '90 days'`,
      [dimensions],
    );
  }

  /**
   * tenant→profile map for one language, keyed by every alias a tenant ref
   * appears under (tenants.id as text AND tenants.code — annotation rows carry
   * either, matching the platform's dual-key tenant refs).
   */
  private async buildTenantProfileMap(
    languageId: number,
  ): Promise<Map<string, string>> {
    const attachments = await this.attachmentRepository.find({
      where: { languageId },
    });
    const map = new Map<string, string>();
    if (attachments.length === 0) return map;
    const aliases: { id: string; code: string }[] =
      await this.attachmentRepository.manager.query(
        `SELECT id::text AS id, code FROM tenants`,
      );
    for (const attachment of attachments) {
      map.set(attachment.tenantId, attachment.profileId);
      for (const alias of aliases) {
        if (alias.id === attachment.tenantId) {
          map.set(alias.code, attachment.profileId);
        } else if (alias.code === attachment.tenantId) {
          map.set(alias.id, attachment.profileId);
        }
      }
    }
    return map;
  }

  /**
   * The session-serving hook: which variety profile does this tenant speak
   * for this language? Dual-key tenant match (uuid or code). Null when the
   * tenant is unattached — the session gets the global glossary only.
   */
  async resolveProfileIdForTenant(
    languageId: number,
    tenantRef: string | null | undefined,
  ): Promise<string | null> {
    if (!tenantRef) return null;
    const rows: { profileId: string }[] =
      await this.attachmentRepository.manager.query(
        `SELECT a."profileId"
           FROM variety_profile_attachments a
          WHERE a."languageId" = $1
            AND (a."tenantId" = $2
                 OR a."tenantId" IN (SELECT id::text FROM tenants WHERE code = $2)
                 OR a."tenantId" IN (SELECT code FROM tenants WHERE id::text = $2))
          LIMIT 1`,
        [languageId, tenantRef],
      );
    return rows[0]?.profileId ?? null;
  }

  private clampImportance(value: unknown): number | undefined {
    if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
    return Math.min(5, Math.max(1, Math.round(value)));
  }

  /**
   * Compact existing-glossary listing for a prompt's "already covered" block.
   *
   * `includePending` decides whether proposals awaiting review are listed, and
   * the two callers need opposite answers:
   *
   *   CONSOLIDATION wants them (true). A queued proposal is as much a
   *   duplicate source as a published line — one Tamil overlay had 11 queued
   *   and invisible, so the consolidator re-proposed them.
   *
   *   ADJUDICATION must NOT have them (false). The proposals being judged ARE
   *   the pending entries, so including them puts every proposal into its own
   *   "existing glossary" block. Measured 2026-09-02: the adjudicator rejected
   *   all 9 queued proposals for "restating a rule already present", quoting
   *   each proposal's own text back as the rule it restated. Requiring that
   *   quote is what exposed it; without it the reasons looked plausible.
   */
  summarizeGlossary(
    sections: LanguageGlossarySection[],
    options: { includePending?: boolean } = {},
  ): string {
    const includePending = options.includePending !== false;
    if (sections.length === 0) return '(no glossary sections exist yet)';
    return sections
      .map((s) => {
        // The prompt is told not to restate what the glossary covers, and this
        // string is the only thing it can check that against — so it must be
        // complete. A 1500-char slice silently hid the tail of the three
        // largest sections in production (up to 1970 chars, and Indic scripts
        // reach the limit fastest), leaving paraphrase duplicates unpreventable.
        // The generous per-section cap is a prompt-size backstop only; a
        // section that big is a curation problem the Tier 0 cap will surface.
        const body = (s.content ?? '').trim().slice(0, 8000);
        // Proposals awaiting review are duplicate sources too — one Tamil
        // overlay had 11 queued and invisible here.
        const pending = includePending
          ? (s.entries ?? [])
              .filter((e) => e.status === GlossaryEntryStatus.PROPOSED)
              .map((e) => e.markdown.trim())
              .filter(Boolean)
          : [];
        const pendingBlock = pending.length
          ? `\n(awaiting review, also do not restate)\n${pending.join('\n')}`
          : '';
        return (
          `### ${s.sectionCode} (${s.injectionMode}, ${s.status}) "${s.title}"\n` +
          `${body || '(empty)'}${pendingBlock}`
        );
      })
      .join('\n\n');
  }

  /** Parse the consolidation model output (tolerating markdown fences). */
  /** Parse v3 output ({sections, engineeringFindings}) tolerating the legacy
   * bare-array shape and markdown fences. */
  private parseConsolidationOutput(raw: string): {
    sections: ConsolidatedSection[];
    engineeringFindings: ConsolidatedEngineeringFinding[];
  } {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new BadRequestException(
        'Glossary consolidation returned unparseable output; retry or adjust the glossary_consolidation prompt',
      );
    }
    const list = Array.isArray(parsed)
      ? parsed
      : ((parsed as Record<string, unknown>)?.sections as unknown[]);
    if (!Array.isArray(list)) {
      throw new BadRequestException(
        'Glossary consolidation output is not a section array',
      );
    }
    const findingsRaw = Array.isArray(parsed)
      ? []
      : ((parsed as Record<string, unknown>)?.engineeringFindings as unknown[]);
    const engineeringFindings = (
      Array.isArray(findingsRaw) ? findingsRaw : []
    ).filter(
      (f): f is ConsolidatedEngineeringFinding =>
        !!f &&
        typeof (f as ConsolidatedEngineeringFinding).summary === 'string',
    );
    return {
      sections: list.filter(
        (s): s is ConsolidatedSection =>
          !!s &&
          typeof (s as ConsolidatedSection).sectionCode === 'string' &&
          Array.isArray((s as ConsolidatedSection).proposals),
      ),
      engineeringFindings,
    };
  }

  /**
   * Accept a consolidation proposal: append its markdown to the section
   * content (cap-checked when the section is live Tier 0) and keep the row as
   * `accepted` so its annotation provenance stays in the consumed-set.
   */
  async acceptProposal(
    languageId: number,
    sectionCode: string,
    entryId: string,
    updatedBy?: string,
    profileId?: string | null,
  ): Promise<LanguageGlossarySection> {
    const section = await this.getSectionOrThrow(
      languageId,
      sectionCode,
      profileId,
    );
    const proposal = (section.entries ?? []).find(
      (e) => e.id === entryId && e.status === GlossaryEntryStatus.PROPOSED,
    );
    if (!proposal) {
      throw new NotFoundException(
        `Proposal ${entryId} not found (or already reviewed) in '${sectionCode}'`,
      );
    }

    const candidate = {
      ...section,
      content:
        `${(section.content ?? '').trimEnd()}\n${proposal.markdown}`.trim(),
    } as LanguageGlossarySection;
    if (
      section.status === GlossarySectionStatus.PUBLISHED &&
      section.injectionMode === GlossaryInjectionMode.ALWAYS
    ) {
      await this.assertTier0WithinCap(languageId, candidate);
    }

    section.content = candidate.content;
    proposal.status = GlossaryEntryStatus.ACCEPTED;
    section.version += 1;
    section.updatedBy = updatedBy;
    return this.glossaryRepository.save(section);
  }

  /** Reject a proposal — kept (status 'rejected') so its annotations stay consumed. */
  async rejectProposal(
    languageId: number,
    sectionCode: string,
    entryId: string,
    updatedBy?: string,
    profileId?: string | null,
  ): Promise<LanguageGlossarySection> {
    const section = await this.getSectionOrThrow(
      languageId,
      sectionCode,
      profileId,
    );
    const proposal = (section.entries ?? []).find(
      (e) => e.id === entryId && e.status === GlossaryEntryStatus.PROPOSED,
    );
    if (!proposal) {
      throw new NotFoundException(
        `Proposal ${entryId} not found (or already reviewed) in '${sectionCode}'`,
      );
    }
    proposal.status = GlossaryEntryStatus.REJECTED;
    section.updatedBy = updatedBy;
    return this.glossaryRepository.save(section);
  }

  private async getSectionOrThrow(
    languageId: number,
    sectionCode: string,
    profileId?: string | null,
  ): Promise<LanguageGlossarySection> {
    const section = await this.glossaryRepository.findSection(
      languageId,
      sectionCode,
      profileId,
    );
    if (!section) {
      throw new NotFoundException(
        `Glossary section '${sectionCode}' not found for language ${languageId}`,
      );
    }
    return section;
  }

  /** Public so sibling glossary services resolve a language the same way. */
  async assertLanguageExists(languageId: number) {
    const language = await this.languagesRepository.findOne({
      where: { id: languageId },
    });
    if (!language) {
      throw new NotFoundException(`Language ${languageId} not found`);
    }
    return language;
  }

  /** Prospective Tier 0 = current published always-set with `candidate` swapped in. */
  private async assertTier0WithinCap(
    languageId: number,
    candidate: LanguageGlossarySection,
  ): Promise<void> {
    // The cap applies to the VIEW the candidate participates in: overlay
    // candidates are checked against global + their profile's overlays.
    const published = await this.glossaryRepository.findPublishedByLanguage(
      languageId,
      GlossaryInjectionMode.ALWAYS,
      candidate.profileId ?? null,
    );
    const prospective = [
      ...published.filter((s) => s.sectionCode !== candidate.sectionCode),
      candidate,
    ];
    const registerPolicy = await this.resolveRegisterPolicy(
      languageId,
      candidate.profileId ?? null,
    );
    const tokens = countGlossaryTokens(
      compileTier0Glossary(prospective, registerPolicy),
    );
    if (tokens > TIER0_TOKEN_CAP) {
      throw new BadRequestException(
        `Tier 0 glossary would be ${tokens} tokens, over the ${TIER0_TOKEN_CAP}-token cap. ` +
          `Trim entries, demote a section to 'retrieved', or archive one first.`,
      );
    }
  }

  /**
   * Resolve a registry prompt's current body + engine settings.
   *
   * Public so the adjudication pass reuses it rather than keeping a second
   * copy of "which version and which model" — the same reasoning that keeps
   * the judge tuple in one place on the analytics side.
   */
  async resolvePromptByCode(promptCode: string) {
    const row = await this.promptRepository.findOne({
      where: { promptCode },
    });
    if (!row) {
      throw new NotFoundException(
        `Prompt '${promptCode}' not found — run migrations`,
      );
    }

    let body: string | null | undefined = row.defaultPrompt;
    if (row.useDashboardOverride && row.currentVersion) {
      const version = await this.promptVersionRepository.findOne({
        where: { promptId: row.id, version: row.currentVersion },
      });
      body = version?.prompt ?? body;
    }
    if (!body) {
      throw new NotFoundException(`Prompt '${promptCode}' has no body`);
    }

    const defaults = this.configService.promptTranslation;
    return {
      systemPrompt: body,
      engine: {
        provider: row.provider || defaults.defaultProvider,
        model: row.model || defaults.defaultModel,
        temperature: row.temperature ?? defaults.temperature,
        maxTokens: defaults.maxTokens,
      },
    };
  }

  /** Parse the model's JSON (tolerating markdown fences) into section drafts. */
  private parseGeneratedSections(raw: string): GeneratedSection[] {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new BadRequestException(
        'Glossary generation returned unparseable output; retry or adjust the glossary_generation prompt',
      );
    }
    const list = Array.isArray(parsed)
      ? parsed
      : ((parsed as Record<string, unknown>)?.sections as unknown[]);
    if (!Array.isArray(list)) {
      throw new BadRequestException(
        'Glossary generation output is not a section array',
      );
    }
    return list.filter(
      (s): s is GeneratedSection =>
        !!s &&
        typeof (s as GeneratedSection).sectionCode === 'string' &&
        typeof (s as GeneratedSection).title === 'string' &&
        typeof (s as GeneratedSection).content === 'string',
    );
  }
}
