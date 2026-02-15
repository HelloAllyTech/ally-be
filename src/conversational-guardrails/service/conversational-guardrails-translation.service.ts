import { Injectable } from '@nestjs/common';
import { GoogleTranslationsService } from 'src/common/service/google-translation.service';
import { LoggerService } from 'src/logger/logger.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { ConversationalGuardrailsTranslationsRepository } from '../repository/conversational-guardrails-translations.repository';
import { ConversationalGuardrails } from '../entity/conversational-guardrails.entity';
import {
  CreateGuardrailTranslation,
  GuardrailMetadata,
} from '../types/guardrail-translation.types';

@Injectable()
export class ConversationalGuardrailsTranslationService {
  private readonly logger = LoggerService.getInstance(
    ConversationalGuardrailsTranslationService.name,
  );

  constructor(
    private readonly sharedLanguageService: SharedLanguageService,
    private readonly googleTranslationService: GoogleTranslationsService,
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly translationsRepository: ConversationalGuardrailsTranslationsRepository,
  ) {}

  async createUpdateGuardrailTranslations(
    guardrails: ConversationalGuardrails[],
  ): Promise<void> {
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

    await this.persistGuardrailTranslations(
      guardrails,
      (guardrail) => ({
        helperDialogue: guardrail.helperDialogue,
        actorDialogue: guardrail.actorDialogue,
      }),
      languages,
    );
  }

  private async buildTranslatedMetadataForLanguageCodes(
    metadataObj: Partial<GuardrailMetadata>,
    languageCodes: string[],
  ): Promise<Record<string, Partial<GuardrailMetadata>>> {
    const codes = (languageCodes ?? [])
      .map((c) => (typeof c === 'string' ? c.trim() : ''))
      .filter(Boolean);

    if (!codes.length) {
      this.logger?.debug?.(
        '[buildTranslatedMetadataForLanguageCodes] no language codes provided',
      );
      return {};
    }
    if (!metadataObj || Object.keys(metadataObj).length === 0) {
      this.logger?.debug?.(
        '[buildTranslatedMetadataForLanguageCodes] no metadata to translate',
      );
      return {};
    }

    try {
      const translated =
        await this.googleTranslationService.translateObjectToLanguages(
          metadataObj,
          codes,
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

  public async persistGuardrailTranslations(
    guardrails: Array<ConversationalGuardrails>,
    metadataExtractor: (g: ConversationalGuardrails) => GuardrailMetadata,
    languages: any,
  ) {
    for (const guardrail of guardrails) {
      try {
        const rawMetadata = metadataExtractor(guardrail);

        const sanitized = this.sanitizeMetadata(rawMetadata);

        if (!sanitized || Object.keys(sanitized).length === 0) {
          this.logger?.debug?.(
            `[persistGuardrailTranslations] ${guardrail.id}: no non-empty metadata, skipping`,
          );
          continue;
        }

        const languagesFiltered = (languages ?? []).filter(
          (l: any) => l && l.translationCode && l.translationCode.trim() !== '',
        );

        if (!languagesFiltered.length) {
          this.logger?.warn?.(
            `[persistGuardrailTranslations] ${guardrail.id}: no valid languages, skipping`,
          );
          continue;
        }

        const languageCodes = languagesFiltered.map((l: any) =>
          l.translationCode.trim(),
        );

        const translatedMap =
          await this.buildTranslatedMetadataForLanguageCodes(
            sanitized as Partial<GuardrailMetadata>,
            languageCodes,
          );

        const translatedList: Array<CreateGuardrailTranslation> = [];

        for (const language of languagesFiltered) {
          const code = language.translationCode.trim();
          const translatedData = translatedMap[code];
          if (!translatedData || Object.keys(translatedData).length === 0)
            continue;
          translatedList.push({
            guardrailId: guardrail.id,
            languageId: Number(language.id),
            helperDialogue: translatedData.helperDialogue ?? '',
            actorDialogue: translatedData.actorDialogue ?? '',
          });
        }

        if (!translatedList.length) {
          this.logger?.debug?.(
            `[persistGuardrailTranslations] ${guardrail.id}: no translations after mapping, skipping DB ops`,
          );
          continue;
        }

        const existingTranslations =
          await this.translationsRepository.getTranslationsByGuardrailId(
            guardrail.id,
          );

        const existingLanguageIdSet = new Set(
          (existingTranslations ?? []).map((r) => Number(r.languageId)),
        );

        const toCreate: Array<CreateGuardrailTranslation> = [];
        const toUpdate: Array<CreateGuardrailTranslation> = [];

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
                guardrailId: updateItem.guardrailId,
                languageId: updateItem.languageId,
              },
              {
                helperDialogue: updateItem.helperDialogue,
                actorDialogue: updateItem.actorDialogue,
              },
            );
          }
        }
      } catch (outerErr) {
        this.logger?.error?.(
          `[persistGuardrailTranslations] unexpected error processing ${guardrail.id}`,
          { outerErr },
        );
      }
    }
  }

  private sanitizeMetadata(
    data?: GuardrailMetadata | null,
  ): Partial<GuardrailMetadata> {
    if (!data) return {};

    const cleaned: Partial<GuardrailMetadata> = {};

    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
          (cleaned as Record<string, unknown>)[key] = trimmed;
        }
      } else if (value != null) {
        (cleaned as Record<string, unknown>)[key] = value;
      }
    }

    return cleaned;
  }

  async getGuardrailsWithTranslations(
    guardrails: ConversationalGuardrails[],
    languageId: number,
  ): Promise<ConversationalGuardrails[]> {
    if (!guardrails.length || !languageId) {
      return guardrails;
    }

    const guardrailIds = guardrails.map((g) => g.id);
    const translations =
      await this.translationsRepository.getTranslationsForGuardrails(
        guardrailIds,
        languageId,
      );

    const translationMap = new Map(translations.map((t) => [t.guardrailId, t]));

    return guardrails.map((guardrail) => {
      const translation = translationMap.get(guardrail.id);
      if (translation) {
        return {
          ...guardrail,
          helperDialogue: translation.helperDialogue,
          actorDialogue: translation.actorDialogue,
        };
      }
      return guardrail;
    });
  }
}
