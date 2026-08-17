/**
 * Course (track) translation types.
 *
 * A course is authored in English and translated per language. Each
 * (track, language) pair is one `track_translations` row whose `content`
 * holds one {@link TranslatedField} per translatable string, keyed by a
 * **stable-id path** into the source entity — never an array index, so
 * reordering questions or units does not silently re-point a translation.
 *
 * Ids are deliberately absent from everything that reaches the LLM: the
 * translator receives a flat `{path: text}` map and its output is read back
 * by key, so it cannot rename an option id, drop a `correctOptionIds` entry
 * or reshape `targets[]`. Structure and answer keys stay exactly as authored;
 * only display strings are ever replaced.
 */

/**
 * Per-language lifecycle. Learners only ever see PUBLISHED.
 *
 * NOT_STARTED is a real, persisted state: the trainer selects the languages a
 * course should become available in, which creates the rows, and the
 * translation job fills them in afterwards.
 */
export enum TrackTranslationStatus {
  NOT_STARTED = 'NOT_STARTED',
  TRANSLATING = 'TRANSLATING',
  READY_FOR_REVIEW = 'READY_FOR_REVIEW',
  PUBLISHED = 'PUBLISHED',
  FAILED = 'FAILED',
}

/** WebSocket events, mirroring `ScenarioTranslationEvents`. */
export enum TrackTranslationEvents {
  CONNECTED = 'CONNECTED',
  JOIN_USER_TRACK_TRANSLATIONS_ROOM = 'JOIN_USER_TRACK_TRANSLATIONS_ROOM',
  TRANSLATION_PROGRESS = 'TRACK_TRANSLATION_PROGRESS',
}

export enum TrackTranslationJobStatus {
  STARTED = 'STARTED',
  TRANSLATING = 'TRANSLATING',
  LANGUAGE_COMPLETED = 'LANGUAGE_COMPLETED',
  LANGUAGE_FAILED = 'LANGUAGE_FAILED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface TrackTranslationProgressPayload {
  jobId: string;
  trackId: string;
  trackTitle?: string;
  status: TrackTranslationJobStatus;
  /** Language `translationCode` (e.g. `hi`) the event concerns. */
  language?: string;
  languageId?: number;
  /** Languages finished (successfully or not) out of the job's total. */
  completed: number;
  total: number;
  /** Fields translated so far within the current language. */
  fieldsCompleted?: number;
  fieldsTotal?: number;
  error?: string;
  emittedAt: string;
}

/**
 * What kind of string a field holds. Drives the per-field instruction handed
 * to the translator — an `HTML` field must come back with its tags intact, a
 * `SHORT_ANSWER` must stay a bare answer with no explanation bolted on.
 */
export enum TranslatableFieldKind {
  TITLE = 'TITLE',
  DESCRIPTION = 'DESCRIPTION',
  /** Rich text; tags, attributes and entities must survive verbatim. */
  HTML = 'HTML',
  /** Free prose: article body text, journal prompt, annotation intro. */
  PROSE = 'PROSE',
  /** A short pickable label: quiz option, annotation label, matching pair. */
  LABEL = 'LABEL',
  /** Fill-blank accepted answer — scoring-critical, must stay minimal. */
  SHORT_ANSWER = 'SHORT_ANSWER',
  /** Grading guidance read by the LLM grader, not by the learner. */
  RUBRIC = 'RUBRIC',
  /** A speaker name in an annotation transcript. */
  SPEAKER = 'SPEAKER',
  /** Fill-blank template carrying `{{blankId}}` tokens that must survive. */
  BLANK_TEMPLATE = 'BLANK_TEMPLATE',
}

/** One extracted English string awaiting translation. */
export interface TranslatableField {
  /** Stable-id path into the entity, e.g. `content.questions[q1].prompt`. */
  path: string;
  value: string;
  kind: TranslatableFieldKind;
  /**
   * This string feeds grading: getting it wrong changes what counts as a
   * correct answer. Scoring fields must be human-reviewed before a language
   * can be published.
   */
  scoring?: boolean;
  /**
   * Extra context handed to the translator, e.g. the question a set of
   * options belongs to. Never itself translated.
   */
  context?: string;
}

export interface TranslatedField {
  value: string;
  /** Hash of the English string this was translated from. */
  sourceHash: string;
  /** Trainer hand-edited this value; re-translation must never overwrite it. */
  edited?: boolean;
  /** A human has confirmed this value. Required on scoring fields to publish. */
  reviewed?: boolean;
  /** Mirrors {@link TranslatableField.scoring} so publish can gate on it. */
  scoring?: boolean;
  /**
   * The English source changed after this value was written, and the value was
   * hand-edited so it could not be safely auto-refreshed. The trainer resolves
   * it; `sourceHash` still holds the *old* English so the diff is recoverable.
   */
  sourceChanged?: boolean;
}

/** path -> translated field, for one entity. */
export type TranslatedFieldMap = Record<string, TranslatedField>;

/**
 * A language's whole translated course. Grouped by entity so the editor can
 * render section-by-section without parsing composite keys, and so applying a
 * translation to an item is a single map lookup.
 */
export interface TrackTranslationContent {
  track: TranslatedFieldMap;
  /** trackSectionId -> fields */
  sections: Record<string, TranslatedFieldMap>;
  /** trackItemId -> fields */
  items: Record<string, TranslatedFieldMap>;
  /**
   * Per-language media overrides, e.g. a dubbed cut of a VIDEO item. Video is
   * a URL, not text, so it is never machine-translated — a trainer either
   * supplies a localised URL here or the learner is told the lesson is in
   * English.
   */
  media?: Record<string, { url?: string }>;
}

export const EMPTY_TRACK_TRANSLATION_CONTENT: TrackTranslationContent = {
  track: {},
  sections: {},
  items: {},
};

/** Per-language counts driving the trainer's review queue. */
export interface TrackTranslationSummary {
  languageId: number;
  /** e.g. `hi` */
  languageCode: string;
  /** e.g. `Hindi` */
  languageLabel: string;
  status: TrackTranslationStatus;
  publishedAt: string | null;
  totalFields: number;
  translatedFields: number;
  /** Scoring fields still awaiting human confirmation. Blocks publish. */
  pendingScoringReview: number;
  /** Hand-edited fields whose English source has since changed. */
  sourceChanged: number;
  /** Fields the trainer has hand-edited. */
  editedFields: number;
  /** Items that will fall back to English for this language. */
  fallbackItems: TrackTranslationFallback[];
  canPublish: boolean;
  /** Why `canPublish` is false, for the trainer. */
  blockedReason: string | null;
  error: string | null;
}

export enum TrackTranslationFallbackReason {
  /** VIDEO item with no per-language URL override. */
  VIDEO_NOT_LOCALISED = 'VIDEO_NOT_LOCALISED',
  /** ROLEPLAY item whose scenario has no translation in this language. */
  SCENARIO_NOT_TRANSLATED = 'SCENARIO_NOT_TRANSLATED',
  /** CASE item; cases carry no translations of their own yet. */
  CASE_NOT_TRANSLATED = 'CASE_NOT_TRANSLATED',
}

export interface TrackTranslationFallback {
  trackItemId: string;
  itemTitle: string;
  reason: TrackTranslationFallbackReason;
}

/** A published language offered to a learner. */
export interface TrackLanguageOption {
  languageId: number;
  /** e.g. `hi` — what the learner sends back and what is persisted. */
  languageCode: string;
  /** Endonym where the languages table has one, e.g. `हिन्दी`. */
  label: string;
  isSource: boolean;
}
