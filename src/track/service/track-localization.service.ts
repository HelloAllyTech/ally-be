import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioTranslations } from 'src/learn/entity/scenario-translation.entity';
import { DEFAULT_LANGUAGE_CODE } from 'src/language/constants/language.constant';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { TrackTranslationRepository } from '../repository/track-translation.repository';
import { TrackTranslation } from '../entity/track-translation.entity';
import { Track } from '../entity/track.entity';
import { TrackItem } from '../entity/track-item.entity';
import { TrackSection } from '../entity/track-section.entity';
import { VideoContent } from '../type/track.type';
import {
  TrackLanguageOption,
  TrackTranslationContent,
  TrackTranslationStatus,
} from '../type/track-translation.type';
import {
  applyItemFields,
  applySectionFields,
  applyTrackFields,
} from '../util/track-translation-fields.util';

/**
 * Published translations for a page of courses, keyed by course and language
 * code. `hi-IN` resolves against a `hi` translation, so a client sending a
 * regional tag still gets the language it asked for.
 */
export class PublishedTranslationIndex {
  constructor(private readonly byTrackAndCode: Map<string, TrackTranslation>) {}

  get(trackId: string, languageCode?: string | null): TrackTranslation | null {
    if (!languageCode) return null;
    return (
      this.byTrackAndCode.get(`${trackId}|${languageCode}`) ??
      this.byTrackAndCode.get(`${trackId}|${languageCode.split('-')[0]}`) ??
      null
    );
  }
}

/**
 * The learner-facing read side of course translation: resolves a language code
 * to a PUBLISHED translation and hands back localised copies of the course's
 * entities.
 *
 * Deliberately narrow — no LLM dependency, no write paths — so the learner
 * request path does not pull in the translation job's stack.
 *
 * Everything here returns *copies*. Nothing on this path may mutate a
 * `track_items` row: item ids anchor every learner's progress rows.
 */
@Injectable()
export class TrackLocalizationService {
  private readonly logger = LoggerService.getInstance(
    TrackLocalizationService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly trackTranslationRepository: TrackTranslationRepository,
    private readonly sharedLanguageService: SharedLanguageService,
  ) {}

  /** True when the code means "serve the English source". */
  isSourceLanguage(languageCode?: string | null): boolean {
    return (
      !languageCode ||
      languageCode === DEFAULT_LANGUAGE_CODE ||
      languageCode.toLowerCase().startsWith(`${DEFAULT_LANGUAGE_CODE}-`)
    );
  }

  /**
   * The PUBLISHED translation for this course in this language, or null to fall
   * back to English. Returning null is a normal outcome, not an error: an
   * unpublished, half-translated or unknown language simply reads in English.
   */
  async resolve(
    trackId: string,
    languageCode?: string | null,
  ): Promise<TrackTranslation | null> {
    if (this.isSourceLanguage(languageCode)) return null;

    const language = await this.sharedLanguageService.getLanguageByLanguageCode(
      languageCode!,
    );
    if (!language) {
      this.logger.warn(`Unknown language code requested: ${languageCode}`);
      return null;
    }

    return this.trackTranslationRepository.findOneByTrackAndLanguage(
      trackId,
      language.id,
    );
  }

  /** As {@link resolve}, but only returns a row learners may be served. */
  async resolvePublished(
    trackId: string,
    languageCode?: string | null,
  ): Promise<TrackTranslation | null> {
    const translation = await this.resolve(trackId, languageCode);
    if (!translation) return null;
    return this.isServable(translation) ? translation : null;
  }

  private isServable(translation: TrackTranslation): boolean {
    return translation.status === TrackTranslationStatus.PUBLISHED;
  }

  /**
   * Languages a learner can pick for this course: English plus every published
   * translation. English is always offered — it is the authored source, so it
   * is never incomplete.
   */
  async listLearnerLanguages(trackId: string): Promise<TrackLanguageOption[]> {
    const published =
      await this.trackTranslationRepository.findPublishedByTrackId(trackId);

    const options: TrackLanguageOption[] = [
      {
        languageId: 0,
        languageCode: DEFAULT_LANGUAGE_CODE,
        label: 'English',
        isSource: true,
      },
    ];
    if (!published.length) return options;

    const languages = await this.sharedLanguageService.getLanguagesByIds(
      published.map((row) => row.languageId),
    );
    const byId = new Map(languages.map((language) => [language.id, language]));

    for (const row of published) {
      const language = byId.get(row.languageId);
      if (!language) continue;
      options.push({
        languageId: language.id,
        languageCode: language.translationCode || language.value,
        label: language.label,
        isSource: false,
      });
    }
    return options;
  }

  /**
   * The learner's language for a course, preferring their persisted per-course
   * choice and falling back to the app language they are browsing in — but only
   * when that language is actually published, so a Hindi-UI learner opening an
   * English-only course reads it in English rather than seeing a broken picker.
   */
  async resolveLearnerLanguage(
    trackId: string,
    persisted?: string | null,
    appLanguage?: string | null,
  ): Promise<string> {
    const options = await this.listLearnerLanguages(trackId);
    const isPublished = (code?: string | null) =>
      !!code && options.some((option) => option.languageCode === code);

    if (isPublished(persisted)) return persisted!;
    // `hi-IN` from a client should still match a `hi` translation.
    const base = appLanguage?.split('-')[0];
    if (isPublished(appLanguage)) return appLanguage!;
    if (isPublished(base)) return base!;
    return DEFAULT_LANGUAGE_CODE;
  }

  /**
   * Batch lookup for list views: every published translation across a page of
   * courses, resolvable by (trackId, language code), in two queries rather than
   * two per course.
   */
  async buildPublishedIndex(
    trackIds: string[],
  ): Promise<PublishedTranslationIndex> {
    const rows =
      await this.trackTranslationRepository.findPublishedByTrackIds(trackIds);
    if (!rows.length) return new PublishedTranslationIndex(new Map());

    const languages = await this.sharedLanguageService.getLanguagesByIds([
      ...new Set(rows.map((row) => row.languageId)),
    ]);
    const codeById = new Map(
      languages.map((language) => [
        language.id,
        language.translationCode || language.value,
      ]),
    );

    const byTrackAndCode = new Map<string, TrackTranslation>();
    for (const row of rows) {
      const code = codeById.get(row.languageId);
      if (code) byTrackAndCode.set(`${row.trackId}|${code}`, row);
    }
    return new PublishedTranslationIndex(byTrackAndCode);
  }

  private contentOf(translation: TrackTranslation): TrackTranslationContent {
    return {
      track: translation.content?.track ?? {},
      sections: translation.content?.sections ?? {},
      items: translation.content?.items ?? {},
      media: translation.content?.media ?? {},
    };
  }

  localizeTrack(track: Track, translation: TrackTranslation | null): Track {
    if (!translation) return track;
    return applyTrackFields(track, this.contentOf(translation).track);
  }

  localizeSection(
    section: TrackSection,
    translation: TrackTranslation | null,
  ): TrackSection {
    if (!translation) return section;
    const fields = this.contentOf(translation).sections[section.id];
    return fields ? applySectionFields(section, fields) : section;
  }

  /**
   * A localised copy of an item. Also applies the per-language VIDEO URL
   * override, which is the one piece of "translation" a trainer supplies by
   * hand rather than the model producing it.
   */
  localizeItem(
    item: TrackItem,
    translation: TrackTranslation | null,
  ): TrackItem {
    if (!translation) return item;
    const content = this.contentOf(translation);
    const localized = applyItemFields(item, content.items[item.id] ?? {});

    const mediaUrl = content.media?.[item.id]?.url;
    if (mediaUrl && localized.content) {
      (localized.content as VideoContent).url = mediaUrl;
    }
    return localized;
  }

  /**
   * Whether this item reads in the learner's language at all. A VIDEO with no
   * localised URL, or a ROLEPLAY/CASE whose linked content has no translation,
   * plays in English — the learner is told so rather than being surprised by it.
   */
  hasLocalisedMedia(
    item: TrackItem,
    translation: TrackTranslation | null,
  ): boolean {
    if (!translation) return true;
    return !!this.contentOf(translation).media?.[item.id]?.url;
  }

  /**
   * Whether a ROLEPLAY item's scenario is itself translated into this language.
   * Scenarios own their own translations (`scenario_translations`), so a course
   * can be fully translated while a roleplay inside it still runs in English.
   */
  async hasScenarioTranslation(
    scenarioId: number | undefined | null,
    languageCode?: string | null,
  ): Promise<boolean> {
    if (!scenarioId) return true;
    if (this.isSourceLanguage(languageCode)) return true;

    const language = await this.sharedLanguageService.getLanguageByLanguageCode(
      languageCode!,
    );
    if (!language) return false;

    const existing = await this.dataSource
      .getRepository(ScenarioTranslations)
      .findOne({ where: { scenarioId, languageId: language.id } });
    return !!existing;
  }
}
