import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { LlmProviderFactory } from 'src/ai-chat/provider/llm-provider.factory';
import { AppConfigService } from 'src/config/config.service';
import { Prompt } from 'src/prompt/entity/prompt.entity';
import { PromptVersion } from 'src/prompt/entity/prompt-version.entity';
import {
  GLOSSARY_GENERATION_PROMPT_CODE,
  TIER0_TOKEN_CAP,
} from '../constants/glossary.constants';
import { UpsertGlossarySectionDto } from '../dto/glossary-section.dto';
import {
  GlossaryEntry,
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
  entries: Partial<GlossaryEntry>[];
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
      entries: dto.entries as GlossaryEntry[],
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
   * Seed job (GL-5): generate a draft glossary for a language via the
   * `glossary_generation` registry prompt. Published sections are never
   * overwritten — drafts only. Returns per-section outcomes.
   */
  async generateDraftGlossary(
    languageId: number,
    createdBy?: string,
  ): Promise<{ created: string[]; updated: string[]; skipped: string[] }> {
    const language = await this.assertLanguageExists(languageId);
    const { systemPrompt, engine } = await this.resolveGenerationPrompt();

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

      const entries: GlossaryEntry[] = (gen.entries ?? [])
        .filter((e) => e && typeof e === 'object')
        .map((e) => ({
          ...(e as GlossaryEntry),
          id: randomUUID(),
          status: GlossaryEntryStatus.PUBLISHED,
          provenance: { source: 'seed' },
        }));

      const section = this.glossaryRepository.create({
        ...(existing ?? {
          languageId,
          sectionCode: gen.sectionCode,
          createdBy,
        }),
        title: gen.title,
        entries,
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

  private async resolveGenerationPrompt() {
    const row = await this.promptRepository.findOne({
      where: { promptCode: GLOSSARY_GENERATION_PROMPT_CODE },
    });
    if (!row) {
      throw new NotFoundException(
        `Prompt '${GLOSSARY_GENERATION_PROMPT_CODE}' not found — run migrations`,
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
      throw new NotFoundException(
        `Prompt '${GLOSSARY_GENERATION_PROMPT_CODE}' has no body`,
      );
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
        Array.isArray((s as GeneratedSection).entries),
    );
  }
}
