import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
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
  GLOSSARY_GENERATION_PROMPT_CODE,
  TIER0_TOKEN_CAP,
} from '../constants/glossary.constants';
import { UpsertGlossarySectionDto } from '../dto/glossary-section.dto';
import {
  GlossaryEntryStatus,
  GlossaryInjectionMode,
  GlossarySectionStatus,
  LanguageGlossarySection,
} from '../entity/language-glossary-section.entity';
import { LanguagesRepository } from '../repository/languages.repository';
import { LanguageGlossaryRepository } from '../repository/language-glossary.repository';
import {
  compileSection,
  compileTier0Glossary,
  countGlossaryTokens,
} from '../util/glossary-compiler.util';

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
  skippedDuplicates: number;
  sections: string[];
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
    const tier0Tokens = countGlossaryTokens(compileTier0Glossary(sections));
    return { sections: views, tier0Tokens, tier0TokenCap: TIER0_TOKEN_CAP };
  }

  async upsertSection(
    languageId: number,
    sectionCode: string,
    dto: UpsertGlossarySectionDto,
    updatedBy?: string,
  ): Promise<LanguageGlossarySection> {
    await this.assertLanguageExists(languageId);
    const existing = await this.glossaryRepository.findSection(
      languageId,
      sectionCode,
    );

    const candidate = this.glossaryRepository.create({
      ...(existing ?? {
        languageId,
        sectionCode,
        status: GlossarySectionStatus.DRAFT,
        createdBy: updatedBy,
      }),
      title: dto.title,
      content: dto.content,
      retrievalHint: dto.retrievalHint,
      injectionMode: dto.injectionMode,
      importance: dto.importance,
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
  ): Promise<LanguageGlossarySection> {
    const section = await this.getSectionOrThrow(languageId, sectionCode);
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
  ): Promise<LanguageGlossarySection> {
    const section = await this.getSectionOrThrow(languageId, sectionCode);
    section.status = GlossarySectionStatus.ARCHIVED;
    section.updatedBy = updatedBy;
    return this.glossaryRepository.save(section);
  }

  /** Compiled Tier 0 style card for a language — the runtime entry point (Phase 2). */
  async resolveTier0Glossary(languageId: number): Promise<string> {
    const sections = await this.glossaryRepository.findPublishedByLanguage(
      languageId,
      GlossaryInjectionMode.ALWAYS,
    );
    return compileTier0Glossary(sections);
  }

  /**
   * Tier 1: published `retrieved` sections compiled to text, for the live
   * agent's knowledge-retrieval title selection (Phase 5). `retrievalHint`
   * tells the selector when to pull a section — glossary sections are
   * production resources (what the NEXT reply needs), not discussion topics.
   */
  async resolveTier1Sections(languageId: number): Promise<
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
  async resolveGlossaryMeta(languageId: number): Promise<{
    versions: Record<string, number>;
    tier0Tokens: number;
  } | null> {
    const sections =
      await this.glossaryRepository.findPublishedByLanguage(languageId);
    if (sections.length === 0) return null;
    const versions: Record<string, number> = {};
    for (const section of sections) {
      versions[section.sectionCode] = section.version;
    }
    return {
      versions,
      tier0Tokens: countGlossaryTokens(compileTier0Glossary(sections)),
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

    for (const gen of generated) {
      const existing = await this.glossaryRepository.findSection(
        languageId,
        gen.sectionCode,
      );
      if (existing && existing.status === GlossarySectionStatus.PUBLISHED) {
        skipped.push(gen.sectionCode);
        continue;
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
        provenance: { source: 'seed' },
        version: (existing?.version ?? 0) + 1,
        updatedBy: createdBy,
      });
      await this.glossaryRepository.save(section);
      (existing ? updated : created).push(gen.sectionCode);
    }

    this.logger.log(
      `[GLOSSARY_SEED] language=${language.value} created=${created.length} updated=${updated.length} skipped=${skipped.length}`,
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
   * Consolidation loop (Phase 4, design §6.2): cluster the language judge's
   * error annotations into PROPOSED glossary entries with provenance back to
   * the annotations they generalize. Entries land as entry-status 'proposed'
   * — invisible to the compiler until a reviewer accepts them — so this can
   * never change what agents say on its own. Annotations already referenced
   * by any entry's provenance are excluded (consumed-set), so re-runs only
   * see new failures.
   */
  async consolidateGlossary(
    languageId: number,
    createdBy?: string,
  ): Promise<ConsolidateGlossaryResult> {
    const language = await this.assertLanguageExists(languageId);
    const sections =
      await this.glossaryRepository.findAllForLanguage(languageId);

    const consumed = new Set<string>();
    for (const section of sections) {
      for (const entry of section.entries ?? []) {
        for (const annotationId of entry.provenance?.annotationIds ?? []) {
          consumed.add(annotationId as string);
        }
      }
    }

    // Cross-tenant read by design: the glossary is global per language, so it
    // learns from every REAL tenant's judged sessions. Internal/demo/QA orgs
    // (tenants.isTestOrganization) are excluded — measured 2026-08-20, test
    // traffic was >50% of the Kannada style-annotation pool, so an unfiltered
    // read learns style rules from our own testers, not the population.
    const recent = await this.annotationRepository
      .createQueryBuilder('a')
      .where('a.language = :language', { language: language.value })
      .andWhere('a.dimension IN (:...dimensions)', {
        dimensions: [...GLOSSARY_CONSOLIDATION_DIMENSIONS],
      })
      .andWhere('a.conditionedOut = false')
      .andWhere(excludeTestTenants('a."tenant_id"'))
      .orderBy('a.occurredAt', 'DESC')
      .take(GLOSSARY_CONSOLIDATION_ANNOTATION_LIMIT)
      .getMany();
    const annotations = recent.filter((a) => !consumed.has(a.id));
    if (annotations.length === 0) {
      return {
        annotationsConsidered: 0,
        proposed: 0,
        skippedDuplicates: 0,
        sections: [],
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
      .join(this.summarizeAnnotations(annotations));

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

    const consolidated = this.parseConsolidatedSections(raw);
    let proposed = 0;
    let skippedDuplicates = 0;
    const touched: string[] = [];

    for (const gen of consolidated) {
      const existing = await this.glossaryRepository.findSection(
        languageId,
        gen.sectionCode,
      );
      const section =
        existing ??
        this.glossaryRepository.create({
          languageId,
          sectionCode: gen.sectionCode,
          title: gen.title || gen.sectionCode.replace(/_/g, ' '),
          content: '',
          entries: [],
          retrievalHint: gen.retrievalHint,
          injectionMode:
            gen.injectionMode === GlossaryInjectionMode.ALWAYS
              ? GlossaryInjectionMode.ALWAYS
              : GlossaryInjectionMode.RETRIEVED,
          status: GlossarySectionStatus.DRAFT,
          provenance: { source: 'consolidation' },
          createdBy,
        });

      // Dedupe against both existing proposals and lines already in the
      // section's markdown content.
      const existingKeys = new Set([
        ...(section.entries ?? []).map((e) => normalizeMarkdown(e.markdown)),
        ...(section.content ?? '')
          .split('\n')
          .map((line) => normalizeMarkdown(line))
          .filter(Boolean),
      ]);

      let appended = 0;
      for (const proposal of gen.proposals ?? []) {
        if (!proposal || typeof proposal.markdown !== 'string') continue;
        const markdown = proposal.markdown.trim();
        if (!markdown) continue;
        const key = normalizeMarkdown(markdown);
        if (existingKeys.has(key)) {
          skippedDuplicates++;
          continue;
        }
        existingKeys.add(key);
        const sourceAnnotations = (proposal.sourceAnnotationIndexes ?? [])
          .map((i) => annotations[i - 1])
          .filter((a): a is LanguageErrorAnnotation => Boolean(a));
        const annotationIds = sourceAnnotations.map((a) => a.id);
        // Which orgs' sessions support this rule — the breadth signal a later
        // global-vs-overlay split reads, recorded now so it needs no backfill.
        const tenantIds = [
          ...new Set(sourceAnnotations.map((a) => a.tenantId).filter(Boolean)),
        ];
        section.entries = [
          ...(section.entries ?? []),
          {
            id: randomUUID(),
            markdown,
            status: GlossaryEntryStatus.PROPOSED,
            importance: this.clampImportance(proposal.importance),
            provenance: { source: 'consolidation', annotationIds, tenantIds },
          },
        ];
        appended++;
      }

      if (appended > 0 || !existing) {
        section.version = (existing?.version ?? 0) + 1;
        section.updatedBy = createdBy;
        await this.glossaryRepository.save(section);
        touched.push(gen.sectionCode);
        proposed += appended;
      }
    }

    const distinctTenants = new Set(
      annotations.map((a) => a.tenantId).filter(Boolean),
    ).size;
    this.logger.log(
      `[GLOSSARY_CONSOLIDATE] language=${language.value} annotations=${annotations.length} tenants=${distinctTenants} proposed=${proposed} duplicates=${skippedDuplicates} sections=${touched.join(',')}`,
    );
    return {
      annotationsConsidered: annotations.length,
      proposed,
      skippedDuplicates,
      sections: touched,
    };
  }

  private clampImportance(value: unknown): number | undefined {
    if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
    return Math.min(5, Math.max(1, Math.round(value)));
  }

  /** Compact existing-glossary listing for the consolidation prompt. */
  private summarizeGlossary(sections: LanguageGlossarySection[]): string {
    if (sections.length === 0) return '(no glossary sections exist yet)';
    return sections
      .map((s) => {
        const body = (s.content ?? '').trim().slice(0, 1500);
        return `### ${s.sectionCode} (${s.injectionMode}, ${s.status}) "${s.title}"\n${body || '(empty)'}`;
      })
      .join('\n\n');
  }

  /** Numbered annotation listing for the consolidation prompt (1-based). */
  private summarizeAnnotations(annotations: LanguageErrorAnnotation[]): string {
    const clip = (v: string | undefined | null, n: number) =>
      (v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
    return annotations
      .map((a, i) => {
        const parts = [
          `#${i + 1} [${a.dimension}/${a.category} ${a.severity}]`,
          a.evidenceQuote ? `span="${clip(a.evidenceQuote, 160)}"` : '',
          a.reasoning ? `reasoning="${clip(a.reasoning, 200)}"` : '',
          a.aiText ? `reply="${clip(a.aiText, 200)}"` : '',
        ];
        return parts.filter(Boolean).join(' ');
      })
      .join('\n');
  }

  /** Parse the consolidation model output (tolerating markdown fences). */
  private parseConsolidatedSections(raw: string): ConsolidatedSection[] {
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
    return list.filter(
      (s): s is ConsolidatedSection =>
        !!s &&
        typeof (s as ConsolidatedSection).sectionCode === 'string' &&
        Array.isArray((s as ConsolidatedSection).proposals),
    );
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
  ): Promise<LanguageGlossarySection> {
    const section = await this.getSectionOrThrow(languageId, sectionCode);
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
  ): Promise<LanguageGlossarySection> {
    const section = await this.getSectionOrThrow(languageId, sectionCode);
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
  ): Promise<LanguageGlossarySection> {
    const section = await this.glossaryRepository.findSection(
      languageId,
      sectionCode,
    );
    if (!section) {
      throw new NotFoundException(
        `Glossary section '${sectionCode}' not found for language ${languageId}`,
      );
    }
    return section;
  }

  private async assertLanguageExists(languageId: number) {
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
    const published = await this.glossaryRepository.findPublishedByLanguage(
      languageId,
      GlossaryInjectionMode.ALWAYS,
    );
    const prospective = [
      ...published.filter((s) => s.sectionCode !== candidate.sectionCode),
      candidate,
    ];
    const tokens = countGlossaryTokens(compileTier0Glossary(prospective));
    if (tokens > TIER0_TOKEN_CAP) {
      throw new BadRequestException(
        `Tier 0 glossary would be ${tokens} tokens, over the ${TIER0_TOKEN_CAP}-token cap. ` +
          `Trim entries, demote a section to 'retrieved', or archive one first.`,
      );
    }
  }

  private async resolvePromptByCode(promptCode: string) {
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

/** Case/whitespace-insensitive identity for markdown-line dedupe. */
function normalizeMarkdown(line: string | undefined): string {
  return (line ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}
