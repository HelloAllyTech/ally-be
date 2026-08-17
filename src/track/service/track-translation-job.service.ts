import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { LoggerService } from 'src/logger/logger.service';
import {
  KeyedTranslationEntry,
  OpenAITranslationsService,
} from 'src/common/service/openai-translation.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { LanguageGlossaryService } from 'src/language/service/language-glossary.service';
import { TrackSharedService } from './track-shared.service';
import { TrackTranslationNotificationService } from './track-translation-notification.service';
import { TrackTranslationRepository } from '../repository/track-translation.repository';
import { TrackTranslation } from '../entity/track-translation.entity';
import {
  EMPTY_TRACK_TRANSLATION_CONTENT,
  TrackTranslationContent,
  TrackTranslationJobStatus,
  TrackTranslationProgressPayload,
  TrackTranslationStatus,
  TranslatableField,
  TranslatedFieldMap,
} from '../type/track-translation.type';
import {
  diffFields,
  extractItemFields,
  extractSectionFields,
  extractTrackFields,
  hashSource,
  toTranslatedField,
} from '../util/track-translation-fields.util';

/** Where a batch of extracted fields belongs in the stored content. */
interface FieldGroup {
  scope: 'track' | 'section' | 'item';
  entityId: string;
  fields: TranslatableField[];
}

/**
 * Runs course translation for one or more languages.
 *
 * Only fields that need it are sent to the model: anything whose English is
 * unchanged since it was last translated is left alone, and anything the
 * trainer hand-edited is never overwritten — it is flagged `sourceChanged`
 * instead, for the trainer to resolve.
 *
 * Languages run sequentially. A whole course is tens of model calls per
 * language, and running four languages at once would multiply the failure blast
 * radius while starving the rest of the app's OpenAI budget.
 */
@Injectable()
export class TrackTranslationJobService {
  private readonly logger = LoggerService.getInstance(
    TrackTranslationJobService.name,
  );

  constructor(
    private readonly trackSharedService: TrackSharedService,
    private readonly trackTranslationRepository: TrackTranslationRepository,
    private readonly sharedLanguageService: SharedLanguageService,
    private readonly languageGlossaryService: LanguageGlossaryService,
    private readonly openaiTranslationsService: OpenAITranslationsService,
    private readonly notificationService: TrackTranslationNotificationService,
  ) {}

  /**
   * Translates `languageIds` for a course. Long-running: callers hand this to
   * `void` and the trainer follows it on the translation socket.
   */
  async run(
    trackId: string,
    languageIds: number[],
    userId: number,
    jobId: string = randomUUID(),
  ): Promise<void> {
    const structure =
      await this.trackSharedService.getTrackWithStructure(trackId);
    const groups = this.buildFieldGroups(structure);

    const emit = (payload: Partial<TrackTranslationProgressPayload>) => {
      this.notificationService.notifyProgress(userId, {
        jobId,
        trackId,
        trackTitle: structure.title,
        completed: 0,
        total: languageIds.length,
        emittedAt: new Date().toISOString(),
        status: TrackTranslationJobStatus.TRANSLATING,
        ...payload,
      } as TrackTranslationProgressPayload);
    };

    emit({ status: TrackTranslationJobStatus.STARTED });

    let completed = 0;
    let anyFailed = false;

    for (const languageId of languageIds) {
      const language = (
        await this.sharedLanguageService.getLanguagesByIds([languageId])
      )[0];
      const languageCode = language?.translationCode || language?.value;

      if (!languageCode) {
        anyFailed = true;
        completed += 1;
        this.logger.error(
          `Track ${trackId}: language ${languageId} has no translation code; skipping`,
        );
        emit({
          status: TrackTranslationJobStatus.LANGUAGE_FAILED,
          languageId,
          completed,
          error: 'This language has no translation code configured.',
        });
        continue;
      }

      try {
        await this.translateLanguage({
          trackId,
          languageId,
          languageCode,
          groups,
          jobId,
          onFieldProgress: (fieldsCompleted, fieldsTotal) =>
            emit({
              status: TrackTranslationJobStatus.TRANSLATING,
              language: languageCode,
              languageId,
              completed,
              fieldsCompleted,
              fieldsTotal,
            }),
        });
        completed += 1;
        emit({
          status: TrackTranslationJobStatus.LANGUAGE_COMPLETED,
          language: languageCode,
          languageId,
          completed,
        });
      } catch (error) {
        anyFailed = true;
        completed += 1;
        const message = (error as Error).message;
        this.logger.error(
          `Track ${trackId} translation to ${languageCode} failed: ${message}`,
        );
        await this.trackTranslationRepository.update(
          { trackId, languageId },
          {
            status: TrackTranslationStatus.FAILED,
            error: message,
            lastJobId: jobId,
          },
        );
        emit({
          status: TrackTranslationJobStatus.LANGUAGE_FAILED,
          language: languageCode,
          languageId,
          completed,
          error: message,
        });
      }
    }

    emit({
      status: anyFailed
        ? TrackTranslationJobStatus.FAILED
        : TrackTranslationJobStatus.COMPLETED,
      completed,
    });
  }

  /**
   * Every translatable string in the course, grouped by the entity it belongs
   * to. Built once and reused across languages — extraction is pure and the
   * source does not change mid-job.
   */
  private buildFieldGroups(
    structure: Awaited<ReturnType<TrackSharedService['getTrackWithStructure']>>,
  ): FieldGroup[] {
    const groups: FieldGroup[] = [
      {
        scope: 'track',
        entityId: structure.id,
        fields: extractTrackFields(structure as any),
      },
    ];

    for (const section of structure.sections) {
      groups.push({
        scope: 'section',
        entityId: section.id,
        fields: extractSectionFields(section as any),
      });
      for (const item of section.items) {
        groups.push({
          scope: 'item',
          entityId: item.id,
          fields: extractItemFields(item),
        });
      }
    }

    // Kept unfiltered even when an entity yields no fields: the group list is
    // also the "what still exists" set that `pruneDeletedEntities` diffs
    // against, so dropping empty groups would delete live entities' entries.
    return groups;
  }

  private async translateLanguage(params: {
    trackId: string;
    languageId: number;
    languageCode: string;
    groups: FieldGroup[];
    jobId: string;
    onFieldProgress: (completed: number, total: number) => void;
  }): Promise<void> {
    const { trackId, languageId, languageCode, groups, jobId } = params;

    const existing =
      (await this.trackTranslationRepository.findOneByTrackAndLanguage(
        trackId,
        languageId,
      )) ?? this.blankRow(trackId, languageId);

    const wasPublished = existing.status === TrackTranslationStatus.PUBLISHED;
    const content = this.normalizeContent(existing.content);

    await this.trackTranslationRepository.update(
      { trackId, languageId },
      {
        status: TrackTranslationStatus.TRANSLATING,
        lastJobId: jobId,
        error: null,
      },
    );

    // Work out what actually needs the model before calling it.
    const plan = groups.map((group) => ({
      group,
      diff: diffFields(group.fields, this.mapFor(content, group)),
    }));

    const pending: { group: FieldGroup; field: TranslatableField }[] = [];
    for (const { group, diff } of plan) {
      for (const field of diff.toTranslate) pending.push({ group, field });
    }

    const glossary = await this.resolveGlossary(languageId);

    let wroteAnything = false;
    if (pending.length) {
      // Keys are `<entityId>::<path>`: unique across the course, and the
      // group/path pair is recovered by splitting on the separator.
      const entries: KeyedTranslationEntry[] = pending.map(
        ({ group, field }) => ({
          key: `${group.entityId}::${field.path}`,
          text: field.value,
          kind: field.kind,
          ...(field.context ? { context: field.context } : {}),
        }),
      );

      const translated =
        await this.openaiTranslationsService.translateKeyedStrings(
          entries,
          languageCode,
          {
            glossary,
            onBatch: (done, total) => params.onFieldProgress(done, total),
          },
        );

      for (const { group, field } of pending) {
        const value = translated[`${group.entityId}::${field.path}`];
        if (!value) continue;
        this.mapFor(content, group, true)[field.path] = toTranslatedField(
          field,
          value,
        );
        wroteAnything = true;
      }
    }

    // Hand-edited fields whose English moved: keep the trainer's wording, but
    // mark it so the review queue surfaces it.
    for (const { group, diff } of plan) {
      const map = this.mapFor(content, group, true);
      for (const field of diff.sourceChanged) {
        const stored = map[field.path];
        if (stored) {
          map[field.path] = {
            ...stored,
            sourceChanged: true,
            reviewed: false,
          };
        }
      }
      // Translations of strings that no longer exist in the course.
      for (const path of diff.orphaned) delete map[path];
    }

    this.pruneDeletedEntities(content, groups);

    // A run that changed nothing leaves a published language published —
    // re-translating a course after a typo fix should not pull three languages
    // off the shelf for no reason.
    const status =
      wasPublished && !wroteAnything
        ? TrackTranslationStatus.PUBLISHED
        : TrackTranslationStatus.READY_FOR_REVIEW;

    await this.trackTranslationRepository.upsert(
      {
        ...existing,
        trackId,
        languageId,
        content,
        status,
        lastJobId: jobId,
        error: null,
      },
      ['trackId', 'languageId'],
    );
  }

  /** Compiled per-language style card, so course Hindi matches roleplay Hindi. */
  private async resolveGlossary(
    languageId: number,
  ): Promise<string | undefined> {
    try {
      const glossary =
        await this.languageGlossaryService.resolveTier0Glossary(languageId);
      return glossary?.trim() ? glossary : undefined;
    } catch (error) {
      // A missing glossary degrades translation quality; it must not fail the run.
      this.logger.warn(
        `Could not resolve glossary for language ${languageId}: ${(error as Error).message}`,
      );
      return undefined;
    }
  }

  private blankRow(trackId: string, languageId: number): TrackTranslation {
    return {
      trackId,
      languageId,
      status: TrackTranslationStatus.NOT_STARTED,
      content: { ...EMPTY_TRACK_TRANSLATION_CONTENT },
    } as TrackTranslation;
  }

  private normalizeContent(
    content?: TrackTranslationContent,
  ): TrackTranslationContent {
    return {
      track: content?.track ?? {},
      sections: content?.sections ?? {},
      items: content?.items ?? {},
      media: content?.media ?? {},
    };
  }

  private mapFor(
    content: TrackTranslationContent,
    group: FieldGroup,
    create = false,
  ): TranslatedFieldMap {
    if (group.scope === 'track') return content.track;
    const bucket = group.scope === 'section' ? content.sections : content.items;
    if (!bucket[group.entityId] && create) bucket[group.entityId] = {};
    return bucket[group.entityId] ?? {};
  }

  /** Drops translations for sections/items deleted from the course. */
  private pruneDeletedEntities(
    content: TrackTranslationContent,
    groups: FieldGroup[],
  ): void {
    const liveSections = new Set(
      groups.filter((g) => g.scope === 'section').map((g) => g.entityId),
    );
    const liveItems = new Set(
      groups.filter((g) => g.scope === 'item').map((g) => g.entityId),
    );

    for (const id of Object.keys(content.sections)) {
      if (!liveSections.has(id)) delete content.sections[id];
    }
    for (const id of Object.keys(content.items)) {
      if (!liveItems.has(id)) delete content.items[id];
    }
    for (const id of Object.keys(content.media ?? {})) {
      if (!liveItems.has(id)) delete content.media![id];
    }
  }

  /** Exposed for the staleness path, which re-hashes without calling the model. */
  hashOf(value: string): string {
    return hashSource(value);
  }
}
