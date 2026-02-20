import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { ScenarioSharedService } from './scenario-shared.service';

import { BehaviorTranslationRepository } from '../repository/behavior-translation.repository';
import { Behavior } from '../entity/behavior.entity';
import { CreateBehaviorTranslation } from '../interface/behavior-translation.interface';
import { DEFAULT_LANGUAGE_TRANSLATION_CODE } from '../constants/scenario-session.constants';
import { BehaviorInstructionTranslationService } from './behavior-instruction-translation.service';

@Injectable()
export class BehaviorTranslationService {
  private readonly logger = LoggerService.getInstance(
    BehaviorTranslationService.name,
  );

  constructor(
    private readonly sharedLanguageService: SharedLanguageService,
    private readonly behaviorInstructionTranslationService: BehaviorInstructionTranslationService,
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly behaviorTranslationRepository: BehaviorTranslationRepository,
  ) {}

  async createBehaviorTranslations(behaviors: Behavior[]): Promise<void> {
    const validLanguagesCodes: number[] =
      await this.scenarioSharedService.getUniqueLanguagesFromScenarioTranslations();

    if (!validLanguagesCodes || validLanguagesCodes.length === 0) {
      return;
    }

    const { languages } =
      await this.sharedLanguageService.getValidLanguages(validLanguagesCodes);

    if (!languages || languages.length === 0) {
      return;
    }

    await this.persistBehaviorTranslations(
      behaviors,
      (behavior) => ({ name: behavior.name }),
      languages,
    );
  }

  private async persistBehaviorTranslations(
    behaviors: Array<Behavior>,
    metadataExtractor: (behavior: Behavior) => { name: string },
    languages: any,
  ) {
    for (const behavior of behaviors) {
      try {
        const rawMetadata = metadataExtractor(behavior);

        const sanitized = this.sanitizeMetadata(rawMetadata);
        if (!sanitized || Object.keys(sanitized).length === 0) {
          this.logger?.debug?.(
            `[persistBehaviorTranslations] ${behavior.id}: no non-empty metadata, skipping`,
          );
          continue;
        }

        const languagesFiltered = (languages ?? []).filter(
          (language: any) =>
            language &&
            language.translationCode &&
            language.translationCode.trim() !== '' &&
            !language.value.includes(DEFAULT_LANGUAGE_TRANSLATION_CODE),
        );

        if (!languagesFiltered.length) {
          this.logger?.warn?.(
            `[persistBehaviorTranslations] ${behavior.id}: no valid languages, skipping`,
          );
          continue;
        }

        const languageCodes = languagesFiltered.map((language: any) =>
          language.translationCode.trim(),
        );

        const translatedMap =
          await this.behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes(
            sanitized,
            languageCodes,
          );

        const translatedList: Array<CreateBehaviorTranslation> = [];

        for (const language of languagesFiltered) {
          const code = language.translationCode.trim();
          const translatedData = translatedMap[code];
          if (!translatedData || Object.keys(translatedData).length === 0)
            continue;
          translatedList.push({
            behaviorId: behavior.id,
            languageId: Number(language.id),
            name: translatedData.name ?? '',
          });
        }

        if (!translatedList.length) {
          this.logger?.debug?.(
            `[persistBehaviorTranslations] ${behavior.id}: no translations after mapping, skipping DB ops`,
          );
          continue;
        }
        await this.behaviorTranslationRepository.save(translatedList);
      } catch (error) {
        this.logger?.error?.(
          `[persistBehaviorTranslations] unexpected error processing ${behavior.id}`,
          { error },
        );
      }
    }
  }

  private sanitizeMetadata(
    data?: Record<string, any> | null,
  ): Record<string, any> {
    if (!data) return {};

    const cleanedData: Record<string, any> = {};

    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
          cleanedData[key] = trimmed;
        }
      } else if (value != null) {
        cleanedData[key] = value;
      }
    }

    return cleanedData;
  }
}
