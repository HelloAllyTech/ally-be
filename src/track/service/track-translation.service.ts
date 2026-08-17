import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, In } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { Languages } from 'src/language/entity/languages.entity';
import { DEFAULT_LANGUAGE_CODE } from 'src/language/constants/language.constant';
import { ScenarioTranslations } from 'src/learn/entity/scenario-translation.entity';
import { TrackSharedService } from './track-shared.service';
import { TrackTranslationJobService } from './track-translation-job.service';
import { TrackTranslationRepository } from '../repository/track-translation.repository';
import { TrackTranslation } from '../entity/track-translation.entity';
import { TrackItem } from '../entity/track-item.entity';
import { TrackItemType } from '../type/track.type';
import {
  EMPTY_TRACK_TRANSLATION_CONTENT,
  TrackTranslationContent,
  TrackTranslationFallback,
  TrackTranslationFallbackReason,
  TrackTranslationStatus,
  TrackTranslationSummary,
  TranslatableField,
  TranslatedField,
  TranslatedFieldMap,
} from '../type/track-translation.type';
import {
  extractItemFields,
  extractSectionFields,
  extractTrackFields,
  hashSource,
} from '../util/track-translation-fields.util';

type FieldScope = 'track' | 'section' | 'item';

export interface TrackFieldEdit {
  scope: FieldScope;
  /** Section or item id; ignored for `track` scope. */
  entityId?: string;
  path: string;
  value: string;
}

export interface TrackFieldRef {
  scope: FieldScope;
  entityId?: string;
  path: string;
}

/** One field as the trainer's editor sees it: English beside the translation. */
export interface EditorField {
  path: string;
  kind: string;
  scoring: boolean;
  english: string;
  translated: string | null;
  edited: boolean;
  reviewed: boolean;
  sourceChanged: boolean;
  /** A scoring field with no human confirmation yet — blocks publish. */
  needsReview: boolean;
}

/**
 * Trainer-facing course translation: which languages a course is available in,
 * the review-and-edit loop over the machine output, and the publish gate.
 *
 * The gate is the point of the whole design. Machine translation is good enough
 * to draft a course and not good enough to grade one unreviewed, so a language
 * cannot go live until a human has confirmed every field that feeds scoring.
 */
@Injectable()
export class TrackTranslationService {
  private readonly logger = LoggerService.getInstance(
    TrackTranslationService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly trackSharedService: TrackSharedService,
    private readonly trackTranslationRepository: TrackTranslationRepository,
    private readonly jobService: TrackTranslationJobService,
  ) {}

  private getUserId(): number | undefined {
    const raw = ExecutionManager.getUserId();
    return raw ? Number(raw) : undefined;
  }

  /* ---------------------------------------------------------------- *
   * Language set
   * ---------------------------------------------------------------- */

  /** Every active language a trainer may add, plus this course's current set. */
  async listForTrack(trackId: string): Promise<{
    availableLanguages: {
      languageId: number;
      languageCode: string;
      label: string;
    }[];
    languages: TrackTranslationSummary[];
  }> {
    const [available, summaries] = await Promise.all([
      this.listActiveLanguages(),
      this.buildSummaries(trackId),
    ]);

    return {
      availableLanguages: available.map((language) => ({
        languageId: language.id,
        languageCode: language.translationCode || language.value,
        label: language.label,
      })),
      languages: summaries,
    };
  }

  /**
   * Active `languages` rows, minus English — the authored source is never a
   * translation target. Driven by the table rather than a hardcoded list so
   * adding a language is a data change, not a deploy.
   */
  private async listActiveLanguages(): Promise<Languages[]> {
    const languages = await this.dataSource.getRepository(Languages).find({
      where: { active: true },
      order: { label: 'ASC' },
    });
    return languages.filter((language) => {
      const code = language.translationCode || language.value;
      return (
        !!code &&
        code !== DEFAULT_LANGUAGE_CODE &&
        !code.toLowerCase().startsWith(`${DEFAULT_LANGUAGE_CODE}-`)
      );
    });
  }

  /**
   * Sets the languages this course should be available in.
   *
   * Adding a language creates its row and kicks off translation immediately —
   * selecting a language is the trainer saying "make this course available in
   * Hindi", so making them press a second button would be ceremony.
   *
   * Removing one deletes its translation. That discards any hand-edits in that
   * language, so the caller is expected to have confirmed it; a published
   * language is refused outright, since removing it would silently pull the
   * course out from under learners already reading it.
   */
  async setLanguages(
    trackId: string,
    languageIds: number[],
  ): Promise<TrackTranslationSummary[]> {
    await this.trackSharedService.getTrackWithStructure(trackId);

    const requested = [...new Set(languageIds)];
    const active = await this.listActiveLanguages();
    const activeIds = new Set(active.map((language) => language.id));

    const unknown = requested.filter((id) => !activeIds.has(id));
    if (unknown.length) {
      throw new BadRequestException(
        `These languages are not available for translation: ${unknown.join(', ')}`,
      );
    }

    const existing =
      await this.trackTranslationRepository.findByTrackId(trackId);
    const existingIds = new Set(existing.map((row) => row.languageId));

    const toRemove = existing.filter(
      (row) => !requested.includes(row.languageId),
    );
    const publishedRemovals = toRemove.filter(
      (row) => row.status === TrackTranslationStatus.PUBLISHED,
    );
    if (publishedRemovals.length) {
      throw new BadRequestException(
        'Unpublish a language before removing it — learners are currently reading this course in it.',
      );
    }
    if (toRemove.length) {
      await this.trackTranslationRepository.delete({
        trackId,
        languageId: In(toRemove.map((row) => row.languageId)),
      });
    }

    const toAdd = requested.filter((id) => !existingIds.has(id));
    if (toAdd.length) {
      const userId = this.getUserId();
      await this.trackTranslationRepository.insert(
        toAdd.map((languageId) => ({
          trackId,
          languageId,
          status: TrackTranslationStatus.NOT_STARTED,
          content: { ...EMPTY_TRACK_TRANSLATION_CONTENT },
          requestedBy: userId ?? null,
        })),
      );
      void this.runJob(trackId, toAdd);
    }

    return this.buildSummaries(trackId);
  }

  /**
   * (Re-)translates the given languages, or every selected language when none
   * are named. Returns immediately; progress arrives on the translation socket.
   */
  async translate(
    trackId: string,
    languageIds?: number[],
  ): Promise<{ jobId: string; languageIds: number[] }> {
    const rows = await this.trackTranslationRepository.findByTrackId(trackId);
    if (!rows.length) {
      throw new BadRequestException(
        'Select at least one language for this course first.',
      );
    }

    const targets = languageIds?.length
      ? rows.filter((row) => languageIds.includes(row.languageId))
      : rows;
    if (!targets.length) {
      throw new BadRequestException(
        'None of the requested languages are selected for this course.',
      );
    }

    const jobId = randomUUID();
    void this.runJob(
      trackId,
      targets.map((row) => row.languageId),
      jobId,
    );
    return { jobId, languageIds: targets.map((row) => row.languageId) };
  }

  /**
   * Fire-and-forget wrapper. The job reports its own per-language failures over
   * the socket and records them on the row, so nothing here can be surfaced to
   * the caller — this catch only stops a rejection escaping into an unhandled
   * promise.
   */
  private runJob(trackId: string, languageIds: number[], jobId?: string): void {
    const userId = this.getUserId();
    if (!userId) {
      this.logger.error(
        `Cannot run track ${trackId} translation without a user in context`,
      );
      return;
    }
    void this.jobService
      .run(trackId, languageIds, userId, jobId)
      .catch((error) =>
        this.logger.error(
          `Track ${trackId} translation job crashed: ${(error as Error).message}`,
        ),
      );
  }

  /* ---------------------------------------------------------------- *
   * Editor
   * ---------------------------------------------------------------- */

  /**
   * The course as the trainer edits it in one language: every translatable
   * string paired with its English source and review state.
   */
  async getEditorView(trackId: string, languageId: number) {
    const [structure, row, language] = await Promise.all([
      this.trackSharedService.getTrackWithStructure(trackId),
      this.requireRow(trackId, languageId),
      this.requireLanguage(languageId),
    ]);
    const content = this.normalize(row.content);
    const summaries = await this.buildSummaries(trackId);

    return {
      trackId,
      languageId,
      languageCode: language.translationCode || language.value,
      label: language.label,
      status: row.status,
      publishedAt: row.publishedAt ?? null,
      error: row.error ?? null,
      summary: summaries.find((s) => s.languageId === languageId) ?? null,
      track: {
        id: structure.id,
        fields: this.toEditorFields(
          extractTrackFields(structure as any),
          content.track,
        ),
      },
      sections: structure.sections.map((section) => ({
        id: section.id,
        order: section.order,
        fields: this.toEditorFields(
          extractSectionFields(section as any),
          content.sections[section.id] ?? {},
        ),
        items: section.items.map((item) => ({
          id: item.id,
          type: item.type,
          order: item.order,
          fields: this.toEditorFields(
            extractItemFields(item),
            content.items[item.id] ?? {},
          ),
          /**
           * VIDEO is a URL, not text, so it is never machine-translated — the
           * trainer either supplies a dubbed cut here or the learner is told
           * the lesson is in English.
           */
          media:
            item.type === TrackItemType.VIDEO
              ? { url: content.media?.[item.id]?.url ?? null }
              : null,
          /** ROLEPLAY/CASE defer to the linked scenario's own translation. */
          deferredTo:
            item.type === TrackItemType.ROLEPLAY
              ? { kind: 'SCENARIO', id: String(item.scenarioId ?? '') }
              : item.type === TrackItemType.CASE
                ? { kind: 'CASE', id: item.caseId ?? '' }
                : null,
        })),
      })),
    };
  }

  private toEditorFields(
    live: TranslatableField[],
    stored: TranslatedFieldMap,
  ): EditorField[] {
    return live.map((field) => {
      const translated = stored[field.path];
      const scoring = !!(field.scoring ?? translated?.scoring);
      const staleSource =
        !!translated && translated.sourceHash !== hashSource(field.value);
      return {
        path: field.path,
        kind: field.kind,
        scoring,
        english: field.value,
        translated: translated?.value ?? null,
        edited: !!translated?.edited,
        reviewed: !!translated?.reviewed,
        sourceChanged: !!translated?.sourceChanged || staleSource,
        needsReview: scoring && !translated?.reviewed,
      };
    });
  }

  /**
   * Saves trainer edits.
   *
   * An edit counts as a review — the trainer typed this value, so nobody else
   * needs to confirm it — and re-anchors the field to the live English, which
   * clears any `sourceChanged` flag. The `edited` flag is what protects the
   * value from being overwritten by a later translation run.
   */
  async updateFields(
    trackId: string,
    languageId: number,
    edits: TrackFieldEdit[],
  ): Promise<{ updated: number }> {
    if (!edits.length) return { updated: 0 };

    const row = await this.requireRow(trackId, languageId);
    const content = this.normalize(row.content);
    const liveByKey = await this.liveFieldIndex(trackId);

    let updated = 0;
    for (const edit of edits) {
      const key = this.fieldKey(edit.scope, edit.entityId, edit.path);
      const live = liveByKey.get(key);
      if (!live) {
        throw new BadRequestException(
          `No such translatable field on this course: ${edit.path}`,
        );
      }
      const map = this.mapFor(content, edit.scope, edit.entityId, true);
      const existing = map[edit.path];
      map[edit.path] = {
        ...existing,
        value: edit.value,
        sourceHash: hashSource(live.value),
        edited: true,
        reviewed: true,
        sourceChanged: false,
        ...(live.scoring ? { scoring: true } : {}),
      };
      updated += 1;
    }

    await this.saveContent(row, content);
    return { updated };
  }

  /**
   * Confirms machine output as-is. With no `fields`, confirms every field
   * awaiting review — an annotation transcript can carry dozens of strings, and
   * a trainer who has read the page through should not have to tick each one.
   */
  async markReviewed(
    trackId: string,
    languageId: number,
    fields?: TrackFieldRef[],
  ): Promise<{ reviewed: number }> {
    const row = await this.requireRow(trackId, languageId);
    const content = this.normalize(row.content);

    let reviewed = 0;
    const confirm = (map: TranslatedFieldMap, path: string) => {
      const existing = map[path];
      if (!existing || existing.reviewed) return;
      map[path] = { ...existing, reviewed: true, sourceChanged: false };
      reviewed += 1;
    };

    if (fields?.length) {
      for (const field of fields) {
        confirm(this.mapFor(content, field.scope, field.entityId), field.path);
      }
    } else {
      for (const map of this.allMaps(content)) {
        for (const path of Object.keys(map)) confirm(map, path);
      }
    }

    await this.saveContent(row, content);
    return { reviewed };
  }

  /** Per-language media override, e.g. a dubbed cut of a VIDEO item. */
  async setMediaUrl(
    trackId: string,
    languageId: number,
    trackItemId: string,
    url: string | null,
  ): Promise<void> {
    const row = await this.requireRow(trackId, languageId);
    const content = this.normalize(row.content);

    const item = await this.dataSource
      .getRepository(TrackItem)
      .findOne({ where: { id: trackItemId, trackId } });
    if (!item) throw new NotFoundException('Track component not found');
    if (item.type !== TrackItemType.VIDEO) {
      throw new BadRequestException(
        'Only video components take a per-language media URL.',
      );
    }

    content.media = content.media ?? {};
    if (url) content.media[trackItemId] = { url };
    else delete content.media[trackItemId];

    await this.saveContent(row, content);
  }

  /* ---------------------------------------------------------------- *
   * Publish
   * ---------------------------------------------------------------- */

  async publish(
    trackId: string,
    languageId: number,
  ): Promise<TrackTranslationSummary> {
    const summaries = await this.buildSummaries(trackId);
    const summary = summaries.find((s) => s.languageId === languageId);
    if (!summary) {
      throw new NotFoundException(
        'This language is not selected for this course',
      );
    }
    if (!summary.canPublish) {
      throw new BadRequestException(
        summary.blockedReason ?? 'This language is not ready to publish.',
      );
    }

    const row = await this.requireRow(trackId, languageId);
    await this.trackTranslationRepository.update(row.id, {
      status: TrackTranslationStatus.PUBLISHED,
      publishedAt: row.publishedAt ?? new Date(),
      publishedBy: this.getUserId() ?? null,
      error: null,
    });

    this.logger.info(
      `Track ${trackId} published in language ${languageId} by user ${this.getUserId()}`,
    );
    return { ...summary, status: TrackTranslationStatus.PUBLISHED };
  }

  /**
   * Takes a language off the shelf. Learners mid-course fall back to English
   * rather than losing access — progress rows are keyed by item id, which is
   * language-independent, so nothing is lost either way.
   */
  async unpublish(trackId: string, languageId: number): Promise<void> {
    const row = await this.requireRow(trackId, languageId);
    if (row.status !== TrackTranslationStatus.PUBLISHED) return;
    await this.trackTranslationRepository.update(row.id, {
      status: TrackTranslationStatus.READY_FOR_REVIEW,
    });
    this.logger.info(
      `Track ${trackId} unpublished in language ${languageId} by user ${this.getUserId()}`,
    );
  }

  /* ---------------------------------------------------------------- *
   * Summaries
   * ---------------------------------------------------------------- */

  async buildSummaries(trackId: string): Promise<TrackTranslationSummary[]> {
    const rows = await this.trackTranslationRepository.findByTrackId(trackId);
    if (!rows.length) return [];

    const structure =
      await this.trackSharedService.getTrackWithStructure(trackId);
    const languages = await this.dataSource.getRepository(Languages).find({
      where: { id: In(rows.map((row) => row.languageId)) },
    });
    const languageById = new Map(languages.map((l) => [l.id, l]));

    // Which scenarios already have a translation, per language — decides whether
    // a ROLEPLAY item reads in the learner's language or falls back to English.
    const scenarioIds = structure.sections
      .flatMap((section) => section.items)
      .filter((item) => item.type === TrackItemType.ROLEPLAY && item.scenarioId)
      .map((item) => item.scenarioId!);
    const scenarioTranslations = scenarioIds.length
      ? await this.dataSource.getRepository(ScenarioTranslations).find({
          where: { scenarioId: In([...new Set(scenarioIds)]) },
        })
      : [];
    const translatedScenarios = new Set(
      scenarioTranslations.map((row) => `${row.scenarioId}:${row.languageId}`),
    );

    const liveGroups = this.liveGroups(structure);

    return rows.map((row) => {
      const language = languageById.get(row.languageId);
      const content = this.normalize(row.content);

      let totalFields = 0;
      let translatedFields = 0;
      let pendingScoringReview = 0;
      let sourceChanged = 0;
      let editedFields = 0;
      let missingFields = 0;

      for (const group of liveGroups) {
        const map = this.mapFor(content, group.scope, group.entityId);
        for (const field of group.fields) {
          totalFields += 1;
          const stored = map[field.path];
          if (!stored?.value) {
            missingFields += 1;
            continue;
          }
          translatedFields += 1;
          if (stored.edited) editedFields += 1;
          const staleSource = stored.sourceHash !== hashSource(field.value);
          if (stored.sourceChanged || staleSource) sourceChanged += 1;
          if ((field.scoring ?? stored.scoring) && !stored.reviewed) {
            pendingScoringReview += 1;
          }
        }
      }

      const fallbackItems = this.buildFallbacks(
        structure,
        content,
        row.languageId,
        translatedScenarios,
      );

      const blockedReason = this.publishBlockedReason({
        status: row.status,
        totalFields,
        missingFields,
        pendingScoringReview,
      });

      return {
        languageId: row.languageId,
        languageCode: language
          ? language.translationCode || language.value
          : String(row.languageId),
        languageLabel: language?.label ?? `Language ${row.languageId}`,
        status: row.status,
        publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
        totalFields,
        translatedFields,
        pendingScoringReview,
        sourceChanged,
        editedFields,
        fallbackItems,
        canPublish: !blockedReason,
        blockedReason,
        error: row.error ?? null,
      };
    });
  }

  /**
   * Why a language cannot go live, in the order a trainer can act on: finish
   * translating, then confirm the graded fields.
   */
  private publishBlockedReason(state: {
    status: TrackTranslationStatus;
    totalFields: number;
    missingFields: number;
    pendingScoringReview: number;
  }): string | null {
    if (state.status === TrackTranslationStatus.TRANSLATING) {
      return 'Translation is still running.';
    }
    if (state.status === TrackTranslationStatus.FAILED) {
      return 'The last translation run failed — run it again before publishing.';
    }
    if (!state.totalFields) {
      return 'This course has no content to translate yet.';
    }
    if (state.missingFields) {
      return `${state.missingFields} field(s) have no translation yet — run translation again.`;
    }
    if (state.pendingScoringReview) {
      return `${state.pendingScoringReview} field(s) that affect scoring still need your confirmation.`;
    }
    return null;
  }

  /** Items that will read in English for this language, and why. */
  private buildFallbacks(
    structure: Awaited<ReturnType<TrackSharedService['getTrackWithStructure']>>,
    content: TrackTranslationContent,
    languageId: number,
    translatedScenarios: Set<string>,
  ): TrackTranslationFallback[] {
    const fallbacks: TrackTranslationFallback[] = [];

    for (const section of structure.sections) {
      for (const item of section.items) {
        if (
          item.type === TrackItemType.VIDEO &&
          !content.media?.[item.id]?.url
        ) {
          fallbacks.push({
            trackItemId: item.id,
            itemTitle: item.title,
            reason: TrackTranslationFallbackReason.VIDEO_NOT_LOCALISED,
          });
        }
        if (
          item.type === TrackItemType.ROLEPLAY &&
          !translatedScenarios.has(`${item.scenarioId}:${languageId}`)
        ) {
          fallbacks.push({
            trackItemId: item.id,
            itemTitle: item.title,
            reason: TrackTranslationFallbackReason.SCENARIO_NOT_TRANSLATED,
          });
        }
        if (item.type === TrackItemType.CASE) {
          fallbacks.push({
            trackItemId: item.id,
            itemTitle: item.title,
            reason: TrackTranslationFallbackReason.CASE_NOT_TRANSLATED,
          });
        }
      }
    }
    return fallbacks;
  }

  /* ---------------------------------------------------------------- *
   * Staleness
   * ---------------------------------------------------------------- */

  /**
   * Called after the English source changes.
   *
   * Fields the trainer never touched are re-translated automatically. Fields
   * they hand-edited are flagged for them to resolve, never overwritten.
   *
   * A published language stays published through a *text* change — the learner
   * briefly sees one string in English, which beats yanking the whole course
   * out from under them. A change to a **scoring** field unpublishes it: a
   * marking key that no longer matches the question fails learners unfairly,
   * and English is the safer thing to serve until a human has looked.
   */
  async handleSourceChanged(trackId: string): Promise<void> {
    const rows = await this.trackTranslationRepository.findByTrackId(trackId);
    if (!rows.length) return;

    const structure =
      await this.trackSharedService.getTrackWithStructure(trackId);
    const liveGroups = this.liveGroups(structure);
    const toRetranslate: number[] = [];

    for (const row of rows) {
      if (row.status === TrackTranslationStatus.TRANSLATING) continue;
      const content = this.normalize(row.content);

      let scoringWentStale = false;
      let anythingStale = false;

      for (const group of liveGroups) {
        const map = this.mapFor(content, group.scope, group.entityId);
        for (const field of group.fields) {
          const stored = map[field.path];
          if (!stored) {
            anythingStale = true;
            if (field.scoring) scoringWentStale = true;
            continue;
          }
          if (stored.sourceHash === hashSource(field.value)) continue;
          anythingStale = true;
          if (field.scoring) scoringWentStale = true;
          if (stored.edited) {
            map[field.path] = {
              ...stored,
              sourceChanged: true,
              reviewed: false,
            };
          }
        }
      }

      if (!anythingStale) continue;

      const nextStatus =
        row.status === TrackTranslationStatus.PUBLISHED && !scoringWentStale
          ? TrackTranslationStatus.PUBLISHED
          : row.status === TrackTranslationStatus.PUBLISHED
            ? TrackTranslationStatus.READY_FOR_REVIEW
            : row.status;

      if (nextStatus !== row.status) {
        this.logger.info(
          `Track ${trackId} language ${row.languageId} unpublished: a scoring field's source changed`,
        );
      }

      await this.trackTranslationRepository.update(row.id, {
        content,
        status: nextStatus,
      });
      toRetranslate.push(row.languageId);
    }

    if (toRetranslate.length) this.runJob(trackId, toRetranslate);
  }

  /* ---------------------------------------------------------------- *
   * Helpers
   * ---------------------------------------------------------------- */

  private liveGroups(
    structure: Awaited<ReturnType<TrackSharedService['getTrackWithStructure']>>,
  ): { scope: FieldScope; entityId: string; fields: TranslatableField[] }[] {
    const groups: {
      scope: FieldScope;
      entityId: string;
      fields: TranslatableField[];
    }[] = [
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
    return groups;
  }

  /** `scope|entityId|path` -> live English field, for validating edits. */
  private async liveFieldIndex(
    trackId: string,
  ): Promise<Map<string, TranslatableField>> {
    const structure =
      await this.trackSharedService.getTrackWithStructure(trackId);
    const index = new Map<string, TranslatableField>();
    for (const group of this.liveGroups(structure)) {
      for (const field of group.fields) {
        index.set(
          this.fieldKey(group.scope, group.entityId, field.path),
          field,
        );
      }
    }
    return index;
  }

  private fieldKey(
    scope: FieldScope,
    entityId: string | undefined,
    path: string,
  ): string {
    return `${scope}|${scope === 'track' ? '' : (entityId ?? '')}|${path}`;
  }

  private normalize(
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
    scope: FieldScope,
    entityId?: string,
    create = false,
  ): TranslatedFieldMap {
    if (scope === 'track') return content.track;
    const bucket = scope === 'section' ? content.sections : content.items;
    const id = entityId ?? '';
    if (!bucket[id] && create) bucket[id] = {};
    return bucket[id] ?? {};
  }

  private allMaps(content: TrackTranslationContent): TranslatedFieldMap[] {
    return [
      content.track,
      ...Object.values(content.sections),
      ...Object.values(content.items),
    ];
  }

  private async saveContent(
    row: TrackTranslation,
    content: TrackTranslationContent,
  ): Promise<void> {
    await this.trackTranslationRepository.update(row.id, { content });
  }

  private async requireRow(
    trackId: string,
    languageId: number,
  ): Promise<TrackTranslation> {
    const row = await this.trackTranslationRepository.findOneByTrackAndLanguage(
      trackId,
      languageId,
    );
    if (!row) {
      throw new NotFoundException(
        'This language is not selected for this course',
      );
    }
    return row;
  }

  private async requireLanguage(languageId: number): Promise<Languages> {
    const language = await this.dataSource
      .getRepository(Languages)
      .findOne({ where: { id: languageId } });
    if (!language) throw new NotFoundException('Language not found');
    return language;
  }
}

/** Re-exported for the DTO layer. */
export type { TranslatedField };
