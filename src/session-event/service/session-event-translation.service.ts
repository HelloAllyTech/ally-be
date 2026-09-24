import { Injectable } from '@nestjs/common';
import { GoogleTranslationsService } from 'src/common/service/google-translation.service';
import { OpenAITranslationsService } from 'src/common/service/openai-translation.service';
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
import {
  DETECTION_DATA_TEXT_OBJECT_ARRAY_PATHS,
  DETECTION_DATA_TRANSLATABLE_PATHS,
} from '../constants/event.constant';
import {
  wrapFieldPlaceholders,
  unwrapFieldPlaceholders,
} from '../util/session-event.util';
import { DEFAULT_LANGUAGE_TRANSLATION_CODE } from 'src/learn/constants/scenario-session.constants';
import { SessionEventSharedService } from './session-event-shared.service';
import { toPromptCode } from 'src/prompt/util/prompt-code.util';
import { sanitizeJsonbMetadata } from 'src/common/util/sanitize-jsonb.util';

@Injectable()
export class SessionEventTranslationService {
  private readonly logger = LoggerService.getInstance(
    SessionEventTranslationService.name,
  );

  constructor(
    private readonly sharedLanguageService: SharedLanguageService,
    private readonly googleTranslationService: GoogleTranslationsService,
    private readonly openAITranslationService: OpenAITranslationsService,
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly sessionEventTranslationsRepository: SessionEventTranslationsRepository,
    private readonly sessionEventSharedService: SessionEventSharedService,
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
      const openaiTranslatedVersion =
        await this.openAITranslationService.translateObjectToLanguages(
          metadataObj,
          codes,
          toPromptCode('openai_translation', 'session_event'),
        );

      if (
        openaiTranslatedVersion &&
        Object.keys(openaiTranslatedVersion).length > 0
      ) {
        this.logger?.debug?.(
          '[buildTranslatedSessionEventMetadataForLanguageCodes] successfully translated using OpenAI',
        );
        return openaiTranslatedVersion as Record<
          string,
          Partial<SessionEventMetadata>
        >;
      }

      this.logger?.debug?.(
        '[buildTranslatedSessionEventMetadataForLanguageCodes] OpenAI translation returned empty, falling back to Google Translate',
      );

      const translated =
        await this.googleTranslationService.translateObjectToLanguages(
          metadataObj,
          codes,
          { mimeType: 'text/html' }, // Use HTML mode to support notranslate spans in branchInstruction
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
          DETECTION_DATA_TEXT_OBJECT_ARRAY_PATHS,
        );

        const sanitized = this.sanitizeSessionEventMetadata({
          name: wrapFieldPlaceholders(rawMetadata?.name),
          message: wrapFieldPlaceholders(rawMetadata?.message),
          branchInstruction: wrapFieldPlaceholders(
            rawMetadata?.branchInstruction,
          ),
          detectionData: translatable,
        });

        if (!sanitized || Object.keys(sanitized).length === 0) {
          this.logger?.debug?.(
            `[persistSessionEventTranslations] ${sessionEvent.id}: no non-empty metadata, skipping`,
          );
          continue;
        }

        const languagesFiltered = (languages ?? []).filter(
          (l: any) =>
            l &&
            l.translationCode &&
            l.translationCode.trim() !== '' &&
            !l.translationCode.startsWith(DEFAULT_LANGUAGE_TRANSLATION_CODE),
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
            name: unwrapFieldPlaceholders(translatedData.name) ?? '',
            message: unwrapFieldPlaceholders(translatedData.message) ?? '',
            branchInstruction:
              unwrapFieldPlaceholders(translatedData.branchInstruction) ?? '',
            detectionData: this.mergeTranslatedFields(
              passthrough,
              translatedData.detectionData as TranslatableMap,
              DETECTION_DATA_TEXT_OBJECT_ARRAY_PATHS,
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

  /**
   * Delegates to the shared `sanitizeJsonbMetadata` helper (same one used by
   * `ScenarioService`/tooltip/behavior-instruction translation) so session-event
   * translations get the same C0-control-character stripping — a stray control
   * byte in LLM output otherwise either fails the Postgres insert or renders as
   * garbled characters in the checklist UI.
   */
  private sanitizeSessionEventMetadata(
    data?: SessionEventMetadata | null,
  ): Partial<SessionEventMetadata> {
    return sanitizeJsonbMetadata(data ?? {});
  }

  /**
   * Split `source` into the half that goes to the translator and the half that
   * rides through untouched.
   *
   * `textObjectArrayPaths` names the paths whose value is an array of
   * `{ text }` objects. Those are unwrapped to `string[]` here — the translator
   * only speaks strings — and re-wrapped by `mergeTranslatedFields`. Unlike
   * every other extracted path they are deliberately LEFT in `passthrough`:
   * merging overwrites them when a good translation comes back, and when one
   * does not, the English original survives. That matters because the runtime
   * reads a translation row's `detectionData` WHOLESALE (the repository
   * COALESCEs the whole jsonb, not key by key), so a key missing from the
   * translated object is a key the session simply does not have — for the
   * few-shot block that silently downgrades the classifier to zero-shot.
   */
  private extractTranslatableFields(
    source: Record<string, any> | undefined,
    allowedPaths: string[],
    textObjectArrayPaths: ReadonlySet<string> = new Set(),
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

      if (textObjectArrayPaths.has(path)) {
        if (
          Array.isArray(value) &&
          value.length > 0 &&
          value.every((v) => v && typeof v.text === 'string' && v.text.trim())
        ) {
          translatable[path] = value.map((v) => v.text.trim());
        }
        // No deleteValueByPath — see the note above.
        continue;
      }

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

  /**
   * Write the translated values back over the passthrough object.
   *
   * For a `textObjectArrayPaths` path the translated `string[]` is re-wrapped
   * as `[{ text }]`, the shape `detectionData` and ally-ai-learn's
   * `_parse_binary_classifier_data` both expect. A translation that came back
   * as anything other than a non-empty array of non-empty strings is SKIPPED
   * rather than written: passthrough still holds the English original (see
   * `extractTranslatableFields`), and few-shot examples in the wrong language
   * beat a malformed value the runtime discards outright.
   */
  private mergeTranslatedFields(
    passthrough: Record<string, any>,
    translated: TranslatableMap | undefined,
    textObjectArrayPaths: ReadonlySet<string> = new Set(),
  ): Record<string, any> {
    if (!translated) return passthrough;

    const merged = structuredClone(passthrough);

    for (const [path, value] of Object.entries(translated)) {
      if (textObjectArrayPaths.has(path)) {
        const texts = Array.isArray(value)
          ? value.filter(
              (v): v is string => typeof v === 'string' && v.trim() !== '',
            )
          : [];
        if (!texts.length) continue;
        this.setValueByPath(
          merged,
          path,
          texts.map((text) => ({ text: text.trim() })),
        );
        continue;
      }
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
    return this.sessionEventSharedService.getSessionEventsTranslationsByScenarioId(
      scenarioId,
      languageId,
    );
  }
}
