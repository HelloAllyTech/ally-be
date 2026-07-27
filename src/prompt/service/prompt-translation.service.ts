import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PromptsRepository } from '../repository/prompt.repository';
import { PromptVersionRepository } from '../repository/prompt-version.repository';
import { PromptTranslationRepository } from '../repository/prompt-translation.repository';
import { PromptTranslationStatus } from '../entity/prompt-translation.entity';
import { PromptSharedService } from './prompt-shared.service';
import { PromptTranslationProviderService } from './prompt-translation-provider.service';
import { PromptTranslationTargetsService } from './prompt-translation-targets.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { validateTranslationTokens } from '../util/translation-token-guard.util';
import {
  AGENT_TEMPLATE_TRANSLATION_PROMPT_CODE,
  MAX_TRANSLATION_ATTEMPTS,
  TRANSLATABLE_PROMPT_TYPES,
} from '../constants/prompt.constants';
import { DEFAULT_LANGUAGE_TRANSLATION_CODE } from 'src/learn/constants/scenario-session.constants';

export interface TranslateOneResult {
  status: PromptTranslationStatus;
  provider: string;
  model: string;
  attempts: number;
  error?: string;
}

export interface TranslatePromptResult {
  promptId: string;
  eligible: boolean;
  reason?: string;
  translated: number;
  skipped: number;
  failed: number;
}

export interface BackfillResult {
  sources: number;
  translated: number;
  skipped: number;
  failed: number;
  perPrompt: TranslatePromptResult[];
}

/**
 * A prompt body to ship for a session, plus an optional runtime engine override
 * (only set when a translated body is served and the translation carries a
 * per-language runtime model).
 */
export interface OverlaidPrompt {
  body: string;
  runtimeProvider?: string;
  runtimeModel?: string;
}

/**
 * Orchestrates translating a single prompt template into a single language
 * (BE-7). Ties together body resolution + hashing (BE-6), the engine/provider
 * path (BE-3), the seeded translation prompt (BE-4), and the token guard (BE-5),
 * writing the result to `prompt_translations` (BE-2).
 *
 * Phase-1 scope: exposed as an internal method + a temporary admin endpoint for
 * manual end-to-end validation. It does NOT yet run automatically on English
 * edits (Phase 2) nor get served at runtime (Phase 3).
 */
@Injectable()
export class PromptTranslationService {
  private readonly logger = new Logger(PromptTranslationService.name);

  constructor(
    private readonly promptsRepository: PromptsRepository,
    private readonly promptVersionRepository: PromptVersionRepository,
    private readonly translationRepository: PromptTranslationRepository,
    private readonly promptSharedService: PromptSharedService,
    private readonly providerService: PromptTranslationProviderService,
    private readonly targetsService: PromptTranslationTargetsService,
    private readonly sharedLanguageService: SharedLanguageService,
  ) {}

  /**
   * Translate one prompt into every eligible target language, skipping
   * languages already fresh (a `ready` row whose `sourceHash` matches the
   * current English body). No-ops (with `eligible=false`) unless the prompt is
   * `translationEnabled` and a translatable type — this is what keeps legacy
   * localized variant rows out of the system. Safe to call fire-and-forget:
   * per-language failures are recorded on the row, not thrown.
   */
  async translatePrompt(promptId: string): Promise<TranslatePromptResult> {
    const base: TranslatePromptResult = {
      promptId,
      eligible: false,
      translated: 0,
      skipped: 0,
      failed: 0,
    };

    const prompt = await this.promptsRepository.findOne({
      where: { id: promptId },
      select: ['id', 'promptCode', 'promptType', 'translationEnabled'],
    });
    if (!prompt) {
      return { ...base, reason: 'prompt not found' };
    }
    if (!prompt.translationEnabled) {
      return { ...base, reason: 'translation not enabled' };
    }
    if (!TRANSLATABLE_PROMPT_TYPES.includes(prompt.promptType ?? '')) {
      return {
        ...base,
        reason: `promptType ${prompt.promptType} not translatable`,
      };
    }

    const body = await this.promptSharedService.getPromptByCode(
      prompt.promptCode,
    );
    if (!body?.trim()) {
      return { ...base, eligible: true, reason: 'no resolvable English body' };
    }
    const sourceHash = this.targetsService.hashBody(body);

    const languages = await this.targetsService.getEligibleTargetLanguages();
    const result: TranslatePromptResult = { ...base, eligible: true };

    // Sequential: only a handful of languages, and this keeps well under
    // provider rate limits when several prompts are enabled at once.
    for (const language of languages) {
      const existing = await this.translationRepository.findByPromptAndLanguage(
        promptId,
        language.id,
      );
      if (
        existing?.status === PromptTranslationStatus.READY &&
        existing.sourceHash === sourceHash
      ) {
        result.skipped++;
        continue;
      }

      try {
        const one = await this.translateOne(promptId, language.id);
        if (one.status === PromptTranslationStatus.READY) result.translated++;
        else result.failed++;
      } catch (err) {
        result.failed++;
        this.logger.error(
          `translatePrompt: ${prompt.promptCode} -> language ${language.id} threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return result;
  }

  /**
   * Runtime serving (Phase 3): given the English prompt bodies about to ship in
   * a session's room metadata and the session language, return the same map with
   * a translated body substituted wherever a `ready` translation exists whose
   * `sourceHash` still matches the current English body. Everything else stays
   * English (today's behavior) — never blocks a session. For an enabled,
   * translatable source that is missing/stale/failed for this language, a
   * background re-translation is kicked off (self-heal) so the next session gets
   * it. Callers should skip this for the source (English) language.
   */
  async overlayTranslations(
    englishByCode: Record<string, string>,
    languageId: number,
  ): Promise<Record<string, OverlaidPrompt>> {
    const passthrough = (): Record<string, OverlaidPrompt> =>
      Object.fromEntries(
        Object.entries(englishByCode).map(([code, body]) => [code, { body }]),
      );

    const codes = Object.keys(englishByCode);
    if (!codes.length || !languageId) return passthrough();

    const [language] = await this.sharedLanguageService.getLanguagesByIds([
      languageId,
    ]);
    if (
      !language ||
      language.translationCode === DEFAULT_LANGUAGE_TRANSLATION_CODE
    ) {
      return passthrough();
    }

    const rows = await this.translationRepository.getRuntimeRows(
      codes,
      languageId,
    );

    const result: Record<string, OverlaidPrompt> = passthrough();
    const selfHeal = new Set<string>();
    const served: string[] = [];

    for (const row of rows) {
      const english = englishByCode[row.promptCode];
      if (english == null) continue;
      const translatable =
        row.translationEnabled &&
        TRANSLATABLE_PROMPT_TYPES.includes(row.promptType ?? '');
      if (!translatable) continue;

      const fresh =
        row.status === PromptTranslationStatus.READY &&
        row.sourceHash === this.targetsService.hashBody(english);

      if (fresh && row.translatedPrompt?.trim()) {
        // Serve the translated body, plus the per-language runtime engine
        // override (which model runs the main agent for this language) when set.
        result[row.promptCode] = {
          body: row.translatedPrompt,
          runtimeProvider: row.runtimeProvider ?? undefined,
          runtimeModel: row.runtimeModel ?? undefined,
        };
        served.push(row.promptCode);
      } else if (row.status !== PromptTranslationStatus.FAILED) {
        // Self-heal only missing/stale rows, NOT `failed` ones: a persistently
        // failing translation must not re-fire Gemini on every session start.
        // A failed row is recovered by an explicit re-translate, or by an
        // English edit (which the update trigger re-translates). Also target
        // only THIS language (getRuntimeRows is scoped to languageId), not all.
        selfHeal.add(row.promptId);
      }
    }

    this.logger.log(
      `[RUNTIME_TRANSLATION] lang ${language.translationCode}: served ${served.length}/${codes.length} translated` +
        (selfHeal.size ? `; self-heal queued for ${selfHeal.size}` : ''),
    );

    for (const promptId of selfHeal) {
      void this.translateOne(promptId, languageId).catch((err: unknown) =>
        this.logger.error(
          `[RUNTIME_TRANSLATION] self-heal failed for ${promptId} (lang ${languageId}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
    }

    return result;
  }

  /** List the stored translation rows for a prompt (all languages) — read model for the UI. */
  listTranslations(promptId: string) {
    return this.translationRepository.findAllForPrompt(promptId);
  }

  /**
   * Set (or clear, with null/empty) the per-language runtime model that runs the
   * main agent when this translation's body is served. No-op if the row doesn't
   * exist yet (nothing translated for that language).
   */
  async setRuntimeModel(
    promptId: string,
    languageId: number,
    provider?: string | null,
    model?: string | null,
  ): Promise<void> {
    await this.translationRepository.setRuntimeModel(
      promptId,
      languageId,
      provider || null,
      model || null,
    );
  }

  /**
   * Warm/refresh translations for every enabled translatable source across all
   * eligible languages (Phase 5 backfill). Sequential per prompt; each prompt's
   * languages are handled by `translatePrompt` (which skips fresh ones), so a
   * repeat run is cheap.
   */
  async backfillEnabledPrompts(): Promise<BackfillResult> {
    const sources = await this.promptsRepository.findTranslationSources(
      TRANSLATABLE_PROMPT_TYPES,
    );
    const perPrompt: TranslatePromptResult[] = [];
    for (const source of sources) {
      perPrompt.push(await this.translatePrompt(source.id));
    }
    const summary: BackfillResult = {
      sources: sources.length,
      translated: perPrompt.reduce((n, r) => n + r.translated, 0),
      skipped: perPrompt.reduce((n, r) => n + r.skipped, 0),
      failed: perPrompt.reduce((n, r) => n + r.failed, 0),
      perPrompt,
    };
    this.logger.log(
      `[BACKFILL] ${summary.sources} sources: translated=${summary.translated} skipped=${summary.skipped} failed=${summary.failed}`,
    );
    return summary;
  }

  async translateOne(
    promptId: string,
    languageId: number,
  ): Promise<TranslateOneResult> {
    // 1. Source prompt + its effective English body.
    const source = await this.promptsRepository.findOne({
      where: { id: promptId },
      select: ['id', 'promptCode'],
    });
    if (!source) {
      throw new NotFoundException(`Prompt ${promptId} not found`);
    }

    const body = await this.promptSharedService.getPromptByCode(
      source.promptCode,
    );
    if (!body?.trim()) {
      throw new BadRequestException(
        `Prompt ${source.promptCode} has no resolvable English body to translate`,
      );
    }
    const sourceHash = this.targetsService.hashBody(body);

    // 2. Target language — never translate into the source (English) language.
    const [language] = await this.sharedLanguageService.getLanguagesByIds([
      languageId,
    ]);
    if (!language) {
      throw new NotFoundException(`Language ${languageId} not found`);
    }
    if (language.translationCode === DEFAULT_LANGUAGE_TRANSLATION_CODE) {
      throw new BadRequestException(
        `Refusing to translate into the source language (${language.translationCode})`,
      );
    }

    // 3. Engine + system prompt from the seeded translation prompt row.
    const [translationRow] = await this.promptSharedService.getPromptsByOptions(
      {
        promptCode: [AGENT_TEMPLATE_TRANSLATION_PROMPT_CODE],
      },
    );
    if (!translationRow?.prompt?.trim()) {
      throw new BadRequestException(
        `Translation prompt ${AGENT_TEMPLATE_TRANSLATION_PROMPT_CODE} is not configured`,
      );
    }
    const engine = this.providerService.resolveEngine(translationRow);
    const systemPrompt = translationRow.prompt.replace(
      /\{\{\s*languageName\s*\}\}/g,
      language.label,
    );
    // getPromptsByOptions selects currentVersion at runtime but erases it from
    // the declared return type; narrow locally for provenance.
    const currentVersion = (translationRow as { currentVersion?: number })
      .currentVersion;
    const translationPromptVersion = currentVersion
      ? String(currentVersion)
      : undefined;

    // 4. Provenance: current version row of the source (best-effort; null for file-backed).
    const version =
      await this.promptVersionRepository.getLatestPromptVersion(promptId);

    // 5. Mark in-progress (records engine so a later failure still shows it).
    await this.translationRepository.upsertTranslation({
      promptId,
      languageId,
      sourceHash,
      status: PromptTranslationStatus.TRANSLATING,
      promptVersionId: version?.id,
      provider: engine.provider,
      model: engine.model,
      translationPromptVersion,
    });

    // 6. Translate with bounded retry + token guard.
    let lastError = 'no attempt made';
    for (let attempt = 1; attempt <= MAX_TRANSLATION_ATTEMPTS; attempt++) {
      try {
        const output = await this.providerService.translate(
          systemPrompt,
          body,
          engine,
        );
        const guard = validateTranslationTokens(body, output);
        if (guard.ok) {
          await this.translationRepository.update(
            { promptId, languageId },
            {
              translatedPrompt: output,
              status: PromptTranslationStatus.READY,
              sourceHash,
              provider: engine.provider,
              model: engine.model,
              translationPromptVersion,
              error: undefined,
            },
          );
          this.logger.log(
            `Translated ${source.promptCode} -> ${language.translationCode} (${engine.provider}/${engine.model}, attempt ${attempt})`,
          );
          return {
            status: PromptTranslationStatus.READY,
            provider: engine.provider,
            model: engine.model,
            attempts: attempt,
          };
        }
        lastError =
          `token mismatch — missing: ` +
          `${[...guard.placeholders.missing, ...guard.audioTags.missing].join(', ') || 'none'}; ` +
          `added: ${[...guard.placeholders.added, ...guard.audioTags.added].join(', ') || 'none'}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      this.logger.warn(
        `Translation attempt ${attempt} for ${source.promptCode} -> ${language.translationCode} failed: ${lastError}`,
      );
    }

    // 7. Exhausted attempts — mark failed.
    await this.translationRepository.markStatus(
      promptId,
      languageId,
      PromptTranslationStatus.FAILED,
      lastError,
    );
    return {
      status: PromptTranslationStatus.FAILED,
      provider: engine.provider,
      model: engine.model,
      attempts: MAX_TRANSLATION_ATTEMPTS,
      error: lastError,
    };
  }
}
