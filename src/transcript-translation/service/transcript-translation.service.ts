import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { OpenAITranslationsService } from 'src/common/service/openai-translation.service';
import { GoogleTranslationsService } from 'src/common/service/google-translation.service';
import { ScenarioSessionMessageTranslationRepository } from '../repository/scenario-session-message-translation.repository';
import { ScenarioSessionMessageTranslation } from '../entity/scenario-session-message-translation.entity';

export type TranscriptTranslationScope = 'scenario';

export interface TranslatableMessage {
  id: number;
  content: string;
}

const LOCK_TTL_SECONDS = 30;
const LOCK_WAIT_ATTEMPTS = 10;
const LOCK_WAIT_DELAY_MS = 300;

@Injectable()
export class TranscriptTranslationService {
  private readonly logger = LoggerService.getInstance(
    TranscriptTranslationService.name,
  );

  constructor(
    private readonly sharedLanguageService: SharedLanguageService,
    private readonly openAITranslationsService: OpenAITranslationsService,
    private readonly googleTranslationsService: GoogleTranslationsService,
    private readonly redisService: RedisService,
    private readonly scenarioSessionMessageTranslationRepository: ScenarioSessionMessageTranslationRepository,
  ) {}

  async translateMessages(
    scope: TranscriptTranslationScope,
    messages: TranslatableMessage[],
    languageCode: string,
  ): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    if (!messages.length) {
      return result;
    }

    const language =
      await this.sharedLanguageService.getLanguageByLanguageCode(languageCode);
    if (!language) {
      this.logger.warn(
        `[translateMessages] Unknown languageCode "${languageCode}", skipping translation`,
      );
      return result;
    }

    const translatableMessages = messages.filter((m) => m.content?.trim());
    const messageIds = translatableMessages.map((m) => m.id);
    const existing =
      await this.scenarioSessionMessageTranslationRepository.findByMessageIdsAndLanguageId(
        messageIds,
        language.id,
      );
    for (const row of existing) {
      result.set(row.scenarioSessionMessageId, row.content);
    }

    const missing = translatableMessages.filter((m) => !result.has(m.id));

    for (const message of missing) {
      const translation = await this.translateAndPersistOne(
        scope,
        message,
        language.id,
        languageCode,
      );
      if (translation) {
        result.set(message.id, translation.content);
      }
    }

    return result;
  }

  private lockKey(
    scope: TranscriptTranslationScope,
    scenarioSessionMessageId: number,
    languageId: number,
  ): string {
    return `transcript-translation-lock:${scope}:${scenarioSessionMessageId}:${languageId}`;
  }

  private async translateAndPersistOne(
    scope: TranscriptTranslationScope,
    message: TranslatableMessage,
    languageId: number,
    languageCode: string,
  ): Promise<ScenarioSessionMessageTranslation | null> {
    const key = this.lockKey(scope, message.id, languageId);
    const acquired = await this.redisService.acquireLock(key, LOCK_TTL_SECONDS);

    if (!acquired) {
      return this.waitForExistingTranslation(message.id, languageId);
    }

    try {
      const existing =
        await this.scenarioSessionMessageTranslationRepository.findOneByMessageIdAndLanguageId(
          message.id,
          languageId,
        );
      if (existing) {
        return existing;
      }

      const content = await this.translateSingleText(
        message.content,
        languageCode,
      );

      return await this.scenarioSessionMessageTranslationRepository.upsertOne({
        scenarioSessionMessageId: message.id,
        languageId,
        content,
      });
    } finally {
      await this.redisService.releaseLock(key);
    }
  }

  private async waitForExistingTranslation(
    scenarioSessionMessageId: number,
    languageId: number,
  ): Promise<ScenarioSessionMessageTranslation | null> {
    for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt++) {
      const existing =
        await this.scenarioSessionMessageTranslationRepository.findOneByMessageIdAndLanguageId(
          scenarioSessionMessageId,
          languageId,
        );
      if (existing) {
        return existing;
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_DELAY_MS));
    }
    return this.scenarioSessionMessageTranslationRepository.findOneByMessageIdAndLanguageId(
      scenarioSessionMessageId,
      languageId,
    );
  }

  private async translateSingleText(
    text: string,
    languageCode: string,
  ): Promise<string> {
    try {
      const openaiResult = await this.openAITranslationsService.translateText(
        text,
        languageCode,
      );
      if (openaiResult && openaiResult.trim() && openaiResult !== text) {
        return openaiResult;
      }
    } catch (error) {
      this.logger.error(
        `[translateSingleText] OpenAI translation failed for ${languageCode}`,
        error as any,
      );
    }

    try {
      const googleResult =
        await this.googleTranslationsService.translateObjectToLanguages(
          { text },
          [languageCode],
        );
      const translated = googleResult?.[languageCode]?.text;
      if (translated) {
        return translated;
      }
    } catch (error) {
      this.logger.error(
        `[translateSingleText] Google translation failed for ${languageCode}`,
        error as any,
      );
    }

    return text;
  }
}
