import { forwardRef, Inject, Injectable } from '@nestjs/common';

import { DEFAULT_LANGUAGE_TRANSLATION_CODE } from 'src/learn/constants/scenario-session.constants';
import { OpenAITranslationsService } from 'src/common/service/openai-translation.service';
import { sanitizeJsonbMetadata } from 'src/common/util/sanitize-jsonb.util';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { LoggerService } from 'src/logger/logger.service';

import { OPENAI_TOOLTIP_TRANSLATION_PROMPT_CODE } from '../constants/tooltip.constants';
import { Tooltip } from '../entity/tooltip.entity';
import { TooltipTranslationsRepository } from '../repository/tooltip-translations.repository';
import {
  CreateTooltipTranslation,
  TooltipMetadata,
} from '../types/tooltip-translation.types';

@Injectable()
export class TooltipTranslationService {
  private readonly logger = LoggerService.getInstance(
    TooltipTranslationService.name,
  );

  constructor(
    private readonly sharedLanguageService: SharedLanguageService,
    private readonly openAITranslationService: OpenAITranslationsService,
    @Inject(forwardRef(() => ScenarioSharedService))
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly translationsRepository: TooltipTranslationsRepository,
  ) {}

  async createUpdateTooltipTranslations(tooltips: Tooltip[]): Promise<void> {
    const validLanguagesCodes: number[] =
      await this.scenarioSharedService.getUniqueLanguagesFromScenarioTranslations();

    if (!validLanguagesCodes || validLanguagesCodes.length === 0) return;

    const { languages } =
      await this.sharedLanguageService.getValidLanguages(validLanguagesCodes);

    if (!languages || languages.length === 0) return;

    await this.persistTooltipTranslations(
      tooltips,
      (tooltip) => ({ tipText: tooltip.tipText }),
      languages,
    );
  }

  private async buildTranslatedMetadataForLanguageCodes(
    metadataObj: Partial<TooltipMetadata>,
    languageCodes: string[],
  ): Promise<Record<string, Partial<TooltipMetadata>>> {
    const codes = (languageCodes ?? [])
      .map((c) => (typeof c === 'string' ? c.trim() : ''))
      .filter(Boolean);

    if (
      !codes.length ||
      !metadataObj ||
      Object.keys(metadataObj).length === 0
    ) {
      return {};
    }

    try {
      const translated =
        await this.openAITranslationService.translateObjectToLanguages(
          metadataObj,
          codes,
          OPENAI_TOOLTIP_TRANSLATION_PROMPT_CODE,
        );
      return translated ?? {};
    } catch (err) {
      this.logger?.error?.(
        '[buildTranslatedMetadataForLanguageCodes] translation call failed',
        { err, languageCodes: codes },
      );
      return {};
    }
  }

  async persistTooltipTranslations(
    tooltips: Tooltip[],
    metadataExtractor: (t: Tooltip) => TooltipMetadata,
    languages: any,
  ) {
    for (const tooltip of tooltips) {
      try {
        const rawMetadata = metadataExtractor(tooltip);
        const sanitized = this.sanitizeMetadata(rawMetadata);

        if (!sanitized || Object.keys(sanitized).length === 0) continue;

        const languagesFiltered = (languages ?? []).filter(
          (l: any) =>
            l &&
            l.translationCode &&
            l.translationCode.trim() !== '' &&
            l.translationCode !== DEFAULT_LANGUAGE_TRANSLATION_CODE,
        );

        if (!languagesFiltered.length) continue;

        const languageCodes = languagesFiltered.map((l: any) =>
          l.translationCode.trim(),
        );

        const translatedMap =
          await this.buildTranslatedMetadataForLanguageCodes(
            sanitized as Partial<TooltipMetadata>,
            languageCodes,
          );

        const translatedList: CreateTooltipTranslation[] = [];

        for (const language of languagesFiltered) {
          const code = language.translationCode.trim();
          const translatedData = translatedMap[code];
          if (!translatedData || Object.keys(translatedData).length === 0)
            continue;
          translatedList.push({
            tooltipId: tooltip.id,
            languageId: Number(language.id),
            tipText: translatedData.tipText ?? '',
          });
        }

        if (!translatedList.length) continue;

        const existingTranslations =
          await this.translationsRepository.getTranslationsByTooltipId(
            tooltip.id,
          );

        const existingLanguageIdSet = new Set(
          (existingTranslations ?? []).map((r) => Number(r.languageId)),
        );

        const toCreate: CreateTooltipTranslation[] = [];
        const toUpdate: CreateTooltipTranslation[] = [];

        for (const t of translatedList) {
          if (existingLanguageIdSet.has(Number(t.languageId))) toUpdate.push(t);
          else toCreate.push(t);
        }

        if (toCreate.length) {
          await this.translationsRepository.save(toCreate);
        }

        if (toUpdate.length) {
          for (const updateItem of toUpdate) {
            await this.translationsRepository.update(
              {
                tooltipId: updateItem.tooltipId,
                languageId: updateItem.languageId,
              },
              { tipText: updateItem.tipText },
            );
          }
        }
      } catch (outerErr) {
        this.logger?.error?.(
          `[persistTooltipTranslations] unexpected error processing ${tooltip.id}`,
          { outerErr },
        );
      }
    }
  }

  /**
   * Sanitize translated tooltip metadata before persisting to the
   * `tooltip_translations.metadata` jsonb column. Delegates to the
   * shared helper so we also strip stray C0 control bytes — OpenAI
   * occasionally leaks NULL bytes into translation output and they
   * would fail the insert with Postgres 22P05.
   */
  private sanitizeMetadata(
    data?: TooltipMetadata | null,
  ): Partial<TooltipMetadata> {
    return sanitizeJsonbMetadata(data ?? {}) as Partial<TooltipMetadata>;
  }

  async getTooltipsWithTranslations(
    tooltips: Tooltip[],
    languageId: number,
  ): Promise<Tooltip[]> {
    if (!tooltips.length || !languageId) return tooltips;

    const tooltipIds = tooltips.map((t) => t.id);
    const translations =
      await this.translationsRepository.getTranslationsForTooltips(
        tooltipIds,
        languageId,
      );

    const translationMap = new Map(translations.map((t) => [t.tooltipId, t]));

    return tooltips.map((tooltip) => {
      const translation = translationMap.get(tooltip.id);
      if (translation) return { ...tooltip, tipText: translation.tipText };
      return tooltip;
    });
  }
}
