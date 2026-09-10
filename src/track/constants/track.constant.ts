export const TRACK_REQUIRED_FIELDS_FOR_PUBLISH = [
  'title',
  'description',
  'coverImageUrl',
];

export const TRACK_MAX_SECTIONS = 20;
export const TRACK_MAX_ITEMS_PER_SECTION = 30;
export const TRACK_MAX_QUIZ_QUESTIONS = 50;

export const TRACK_DEFAULT_VIDEO_WATCH_PCT = 90;
export const TRACK_DEFAULT_QUIZ_PASS_SCORE = 70;

/** ANNOTATED_ARTIFACT limits. Eight labels = the eight AnnotationSwatch values. */
export const TRACK_MAX_ANNOTATION_UNITS = 300;
export const TRACK_MAX_ANNOTATION_LABELS = 8;
export const TRACK_DEFAULT_ANNOTATION_PASS_SCORE = 70;
export const TRACK_DEFAULT_ANNOTATION_FALSE_POSITIVE_PENALTY = 1;

/** Track lesson videos are full content (unlike 15s scenario cover videos). */
export const TRACK_VIDEO_FILE_SIZE_LIMIT = 500 * 1024 * 1024; // 500MB
export const TRACK_VIDEO_FILE_DURATION_LIMIT = 30 * 60; // 30 minutes
export const TRACK_IMAGE_FILE_SIZE_LIMIT = 10 * 1024 * 1024; // 10MB

export enum TrackMediaKind {
  IMAGE = 'image',
  VIDEO = 'video',
}

export const TRACK_MEDIA_ALLOWED_CONTENT_TYPES: Record<
  TrackMediaKind,
  string[]
> = {
  [TrackMediaKind.IMAGE]: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
  ],
  [TrackMediaKind.VIDEO]: ['video/mp4', 'video/webm', 'video/quicktime'],
};

/** Per-question timeout for LLM grading of open-ended quiz answers. */
export const TRACK_QUIZ_LLM_GRADING_TIMEOUT_MS = 20_000;

/**
 * Evaluated ROLEPLAY sessions a skillCoverage category needs, within one
 * course, before its average is trusted enough to classify. One session is
 * one LLM judge's read of one conversation; the spread between a learner's
 * adjacent sessions is routinely tens of points (same reasoning as
 * SKILL_TREND_WINDOW in skill-growth-analytics.repository.ts). Below this,
 * the category reads as `insufficient_data` regardless of its average.
 */
export const TRACK_PROGRESS_MIN_SKILL_SAMPLE = 2;

/**
 * Average skillCoverage percentage at/above which a category reads
 * `demonstrated` rather than `needs_practice`. Reuses the pass bar every
 * other scored Track component already treats as passing
 * (TRACK_DEFAULT_QUIZ_PASS_SCORE / TRACK_DEFAULT_ANNOTATION_PASS_SCORE are
 * both 70) rather than inventing a second, disconnected cutoff for roleplay
 * skill coverage specifically.
 */
export const TRACK_PROGRESS_SKILL_DEMONSTRATED_PCT = 70;
