import { Injectable } from '@nestjs/common';
import { GoogleTranslationsService } from 'src/common/service/google-translation.service';
import { LoggerService } from 'src/logger/logger.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { SessionEventTranslationsRepository } from '../repository/session-event-translation.repository';
import {
  SessionEventMetadata,
  TranslatableMap,
} from '../type/session-event-translation-data.type';
import { SessionEvents } from '../entity/session-events.entity';
import { CreateSessionEventTranslation } from '../interface/session-events-translation.interface';
import { DETECTION_DATA_TRANSLATABLE_PATHS } from '../constants/event.constant';

@Injectable()
export class SessionEventTranslationService {
  private readonly logger = LoggerService.getInstance(
    SessionEventTranslationService.name,
  );

  constructor(
    private readonly sharedLanguageService: SharedLanguageService,
    private readonly googleTranslationService: GoogleTranslationsService,
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly sessionEventTranslationsRepository: SessionEventTranslationsRepository,
  ) {}

  async createUpdateSessionEventTranslations(events: any[]): Promise<void> {
    const validLanguagesCodes: number[] =
      await this.scenarioSharedService.getUniqueLanguagesFromScenarioTranslations();

    if (!validLanguagesCodes || validLanguagesCodes.length === 0) {
      return;
    }

    const { languages } =
      await this.sharedLanguageService.getValidLanguages(validLanguagesCodes);

    await this.persistSessionEventTranslations(
      events, // array of session events or single-element array
      (sessionEvent) => ({
        name: sessionEvent.name,
        message: sessionEvent.message,
        branchInstruction: sessionEvent.branchInstruction,
        detectionData: sessionEvent.detectionData,
      }),
      languages,
    );
  }

  /**
   * Build translated session-event metadata map for a list of language codes.
   * Returns an object: { [langCode]: Partial<SessionEventMetadata> }
   */
  private async buildTranslatedSessionEventMetadataForLanguageCodes(
    metadataObj: Partial<SessionEventMetadata>,
    languageCodes: string[],
  ): Promise<Record<string, Partial<SessionEventMetadata>>> {
    const codes = (languageCodes ?? [])
      .map((c) => (typeof c === 'string' ? c.trim() : ''))
      .filter(Boolean);

    if (!codes.length) {
      this.logger?.debug?.(
        '[buildTranslatedSessionEventMetadataForLanguageCodes] no language codes provided',
      );
      return {};
    }
    if (!metadataObj || Object.keys(metadataObj).length === 0) {
      this.logger?.debug?.(
        '[buildTranslatedSessionEventMetadataForLanguageCodes] no metadata to translate',
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
        '[buildTranslatedSessionEventMetadataForLanguageCodes] translation call failed',
        { err, languageCodes: codes },
      );
      return {};
    }
  }

  /**
   * Persist translations for session events (create new rows for new languages, update existing rows).
   *
   * - sessionEvents: array of objects (each must have id)
   * - metadataExtractor: (sessionEvent) => SessionEventMetadata
   * - languageVoicesExtractor: (sessionEvent) => languageVoices
   */
  public async persistSessionEventTranslations(
    sessionEvents: Array<SessionEvents>,
    metadataExtractor: (se: any) => SessionEventMetadata,
    languages: any,
  ) {
    for (const sessionEvent of sessionEvents) {
      try {
        const rawMetadata = metadataExtractor(sessionEvent);

        const { translatable, passthrough } = this.extractTranslatableFields(
          rawMetadata?.detectionData ?? {},
          DETECTION_DATA_TRANSLATABLE_PATHS,
        );

        const sanitized = this.sanitizeSessionEventMetadata({
          name: rawMetadata?.name,
          message: rawMetadata?.message,
          branchInstruction: rawMetadata?.branchInstruction,
          detectionData: translatable,
        });

        if (!sanitized || Object.keys(sanitized).length === 0) {
          this.logger?.debug?.(
            `[persistSessionEventTranslations] ${sessionEvent.id}: no non-empty metadata, skipping`,
          );
          continue;
        }

        const languagesFiltered = (languages ?? []).filter(
          (l: any) => l && l.translationCode && l.translationCode.trim() !== '',
        );

        if (!languagesFiltered.length) {
          this.logger?.warn?.(
            `[persistSessionEventTranslations] ${sessionEvent.id}: no valid languages, skipping`,
          );
          continue;
        }

        const languageCodes = languagesFiltered.map((l: any) =>
          l.translationCode.trim(),
        );

        const translatedMap =
          await this.buildTranslatedSessionEventMetadataForLanguageCodes(
            sanitized as Partial<SessionEventMetadata>,
            languageCodes,
          );

        // Map translated map back to sessionEventId + languageId
        const translatedList: Array<CreateSessionEventTranslation> = [];

        for (const language of languagesFiltered) {
          const code = language.translationCode.trim();
          const translatedData = translatedMap[code];
          if (!translatedData || Object.keys(translatedData).length === 0)
            continue;
          translatedList.push({
            sessionEventId: sessionEvent.id,
            languageId: Number(language.id),
            name: translatedData.name ?? '',
            message: translatedData.message ?? '',
            branchInstruction: translatedData.branchInstruction ?? '',
            detectionData: this.mergeTranslatedFields(
              passthrough,
              translatedData.detectionData as TranslatableMap,
            ),
          });
        }

        if (!translatedList.length) {
          this.logger?.debug?.(
            `[persistSessionEventTranslations] ${sessionEvent.id}: no translations after mapping, skipping DB ops`,
          );
          continue;
        }

        // Fetch existing translations for this sessionEvent to split create vs update
        const existingTranslations =
          await this.sessionEventTranslationsRepository.getSessionEventTranslationsBySessionEventId(
            sessionEvent.id,
          );

        const existingLanguageIdSet = new Set(
          (existingTranslations ?? []).map((r) => Number(r.languageId)),
        );

        const toCreate: Array<any> = [];
        const toUpdate: Array<any> = [];

        for (const t of translatedList) {
          if (existingLanguageIdSet.has(Number(t.languageId))) toUpdate.push(t);
          else toCreate.push(t);
        }

        if (toCreate.length) {
          await this.sessionEventTranslationsRepository.createSessionEventTranslations(
            toCreate,
          );
        }

        if (toUpdate.length) {
          await this.sessionEventTranslationsRepository.updateSessionTranslations(
            toUpdate,
          );
        }
      } catch (outerErr) {
        this.logger?.error?.(
          `[persistSessionEventTranslations] unexpected error processing ${sessionEvent.id}`,
          { outerErr },
        );
      }
    }
  }

  private sanitizeSessionEventMetadata(
    data?: SessionEventMetadata | null,
  ): Partial<SessionEventMetadata> {
    if (!data) return {};

    const cleaned: Partial<SessionEventMetadata> = {};

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

  private extractTranslatableFields(
    source: Record<string, any> | undefined,
    allowedPaths: string[],
  ): {
    translatable: TranslatableMap;
    passthrough: Record<string, any>;
  } {
    if (!source || typeof source !== 'object') {
      return { translatable: {}, passthrough: {} };
    }

    const translatable: TranslatableMap = {};
    const passthrough = structuredClone(source);

    for (const path of allowedPaths) {
      const value = this.getValueByPath(source, path);

      if (typeof value === 'string' && value.trim()) {
        translatable[path] = value.trim();
        this.deleteValueByPath(passthrough, path);
      } else if (
        Array.isArray(value) &&
        value.every((v) => typeof v === 'string' && v.trim())
      ) {
        translatable[path] = value.map((v) => v.trim());
        this.deleteValueByPath(passthrough, path);
      }
    }

    return {
      translatable,
      passthrough,
    };
  }

  private mergeTranslatedFields(
    passthrough: Record<string, any>,
    translated: TranslatableMap | undefined,
  ): Record<string, any> {
    if (!translated) return passthrough;

    const merged = structuredClone(passthrough);

    for (const [path, value] of Object.entries(translated)) {
      this.setValueByPath(merged, path, value);
    }

    return merged;
  }

  private getValueByPath(obj: any, path: string): any {
    return path.split('.').reduce((acc, key) => acc?.[key], obj);
  }

  private setValueByPath(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    let current = obj;

    keys.forEach((key, index) => {
      if (index === keys.length - 1) {
        current[key] = value;
      } else {
        current[key] ??= {};
        current = current[key];
      }
    });
  }

  private deleteValueByPath(obj: any, path: string): void {
    const keys = path.split('.');
    let current = obj;

    keys.forEach((key, index) => {
      if (!current) return;

      if (index === keys.length - 1) {
        delete current[key];
      } else {
        current = current[key];
      }
    });
  }

  async getSessionEventsTranslationsByScenarioId(
    scenarioId: number,
    languageId: number,
  ): Promise<SessionEvents[]> {
    const events =
      await this.sessionEventTranslationsRepository.getSessionEventTranslationsByForMetaData(
        scenarioId,
        languageId,
      );

    return events
      .filter((event) => !event.autoTerminationStatus) // Filter out auto termination events to get correct feedback messages
      .map((event) => ({
        id: event.sessionEvents_id,
        name: event.sessionEvents_name,
        description: event.sessionEvents_description,
        score: event.scenarioEvents_score ?? event.sessionEvents_score,
        emoji:
          (event.scenarioEvents_feedbackStatus ?? true)
            ? event.scenarioEvents_emoji
            : event.sessionEvents_emoji,
        message:
          (event.scenarioEvents_feedbackStatus ?? true)
            ? event.scenarioEvents_message
            : event.sessionEvents_message,
        branchInstruction:
          (event.scenarioEvents_branchingStatus ?? true)
            ? (event.scenarioEvents_branchInstruction ??
              event.sessionEvents_branchInstruction)
            : null,
        detectionType: event.sessionEvents_detectionType,
        data: event.sessionEvents_detectionData,
        visibilityType: event.sessionEvents_visibilityType,
        feedbackStatus: event.scenarioEvents_feedbackStatus,
        speaker: event.sessionEvents_speaker,
        createdAt: event.sessionEvents_createdAt,
        updatedAt: event.sessionEvents_updatedAt,
        eventCode: event.sessionEvents_eventCode,
      }));
  }
}
