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
