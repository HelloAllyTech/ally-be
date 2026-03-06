import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { OpenAITranslationsService } from 'src/common/service/openai-translation.service';
import { toPromptCode } from 'src/prompt/util/prompt-code.util';

@Injectable()
export class BehaviorInstructionTranslationService {
  private readonly logger = LoggerService.getInstance(
    BehaviorInstructionTranslationService.name,
  );

  constructor(
    private readonly openAITranslationService: OpenAITranslationsService,
  ) {}

  async buildTranslatedMetadataForLanguageCodes(
    metadataObj: Record<string, any>,
    languageCodes: string[],
  ): Promise<Record<string, Record<string, any>>> {
    const codes = (languageCodes ?? [])
      .map((code) => (typeof code === 'string' ? code.trim() : ''))
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
        await this.openAITranslationService.translateObjectToLanguages(
          metadataObj,
          codes,
          toPromptCode('openai_translation', 'learn_behavior_instruction'),
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
}
