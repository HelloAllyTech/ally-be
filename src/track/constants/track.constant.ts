export const TRACK_REQUIRED_FIELDS_FOR_PUBLISH = [
  'title',
  'description',
  'coverImageUrl',
];

/**
 * Competencies one course may be tagged with (`tracks.competencyIds`). The
 * seeded library is the 15 foundational helping skills, so this admits a course
 * that claims every one of them and nothing past that. A course that claims all
 * fifteen tells Analytics → Course impact nothing it could not already assume.
 */
export const TRACK_MAX_COMPETENCIES = 15;

export const TRACK_MAX_SECTIONS = 20;
export const TRACK_MAX_ITEMS_PER_SECTION = 30;
export const TRACK_MAX_QUIZ_QUESTIONS = 50;

/**
 * Inline questions per ARTICLE. Deliberately far below the quiz ceiling: an
 * article question is a reading check punctuating prose, and an article
 * carrying dozens of them is a quiz that has been written in the wrong place.
 */
export const TRACK_MAX_ARTICLE_QUESTIONS = 10;

/**
 * Curated external links per ARTICLE. A short, trainer-picked reading list,
 * not a bibliography — kept well below the question ceiling for the same
 * reason: past this many, the links belong in their own resource page.
 */
export const TRACK_MAX_ARTICLE_RESOURCES = 10;

/**
 * Likert bounds. A scale needs two points to be a choice and past ten stops
 * being a scale anyone reads point by point; twenty statements is already a
 * long survey for one screen.
 */
export const TRACK_LIKERT_MIN_SCALE_POINTS = 2;
export const TRACK_LIKERT_MAX_SCALE_POINTS = 10;
export const TRACK_LIKERT_MAX_STATEMENTS = 20;

export const TRACK_DEFAULT_VIDEO_WATCH_PCT = 90;
export const TRACK_DEFAULT_QUIZ_PASS_SCORE = 70;

/** ANNOTATED_ARTIFACT limits. Eight labels = the eight AnnotationSwatch values. */
export const TRACK_MAX_ANNOTATION_UNITS = 300;
export const TRACK_MAX_ANNOTATION_LABELS = 8;
export const TRACK_DEFAULT_ANNOTATION_PASS_SCORE = 70;
export const TRACK_DEFAULT_ANNOTATION_FALSE_POSITIVE_PENALTY = 1;

/** BRANCHING_SCENARIO limits. */
export const TRACK_DEFAULT_BRANCHING_PASS_SCORE = 70;
export const TRACK_MAX_BRANCHING_NODES = 100;
export const TRACK_MIN_BRANCHING_CHOICES = 2;
export const TRACK_MAX_BRANCHING_CHOICES = 6;
export const TRACK_MAX_BRANCHING_NODE_TEXT = 1500;
export const TRACK_MAX_BRANCHING_CHOICE_TEXT = 250;
export const TRACK_MAX_BRANCHING_TITLE = 120;
export const TRACK_MAX_BRANCHING_TAKEAWAY = 800;
/** A finished run can be no longer than this many choices; a sanity rail for cycles. */
export const TRACK_MAX_BRANCHING_PATH_LENGTH = 100;

/** BUCKET_SORT limits. */
export const TRACK_MIN_BUCKET_SORT_BUCKETS = 2;
export const TRACK_MAX_BUCKET_SORT_BUCKETS = 6;
export const TRACK_MIN_BUCKET_SORT_ITEMS = 2;
export const TRACK_MAX_BUCKET_SORT_ITEMS = 30;
export const TRACK_MAX_BUCKET_SORT_LABEL = 60;
export const TRACK_MAX_BUCKET_SORT_DESCRIPTION = 160;
export const TRACK_MAX_BUCKET_SORT_ITEM_TEXT = 200;
export const TRACK_MAX_BUCKET_SORT_EXPLANATION = 500;

/** Track lesson videos are full content (unlike 15s scenario cover videos). */
export const TRACK_VIDEO_FILE_SIZE_LIMIT = 500 * 1024 * 1024; // 500MB
export const TRACK_VIDEO_FILE_DURATION_LIMIT = 30 * 60; // 30 minutes
export const TRACK_IMAGE_FILE_SIZE_LIMIT = 10 * 1024 * 1024; // 10MB

/**
 * Media attached to a single question is capped far below the lesson limits
 * above. A lesson video is the thing the learner came for and they expect to
 * wait for it; question media sits between the learner and an answer they
 * cannot give until it has loaded, on the phone-tethered connections our CHW
 * users actually have. Sizing this at spec time rather than leaving it to
 * whatever the trainer happens to drag in is the point.
 */
export const TRACK_QUESTION_IMAGE_FILE_SIZE_LIMIT = 5 * 1024 * 1024; // 5MB
export const TRACK_QUESTION_VIDEO_FILE_SIZE_LIMIT = 50 * 1024 * 1024; // 50MB
export const TRACK_QUESTION_VIDEO_DURATION_LIMIT = 3 * 60; // 3 minutes

export enum TrackMediaKind {
  IMAGE = 'image',
  VIDEO = 'video',
  QUESTION_IMAGE = 'question_image',
  QUESTION_VIDEO = 'question_video',
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
  [TrackMediaKind.QUESTION_IMAGE]: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
  ],
  [TrackMediaKind.QUESTION_VIDEO]: [
    'video/mp4',
    'video/webm',
    'video/quicktime',
  ],
};

/** Byte ceiling per media kind, enforced when the presigned URL is minted. */
export const TRACK_MEDIA_SIZE_LIMITS: Record<TrackMediaKind, number> = {
  [TrackMediaKind.IMAGE]: TRACK_IMAGE_FILE_SIZE_LIMIT,
  [TrackMediaKind.VIDEO]: TRACK_VIDEO_FILE_SIZE_LIMIT,
  [TrackMediaKind.QUESTION_IMAGE]: TRACK_QUESTION_IMAGE_FILE_SIZE_LIMIT,
  [TrackMediaKind.QUESTION_VIDEO]: TRACK_QUESTION_VIDEO_FILE_SIZE_LIMIT,
};

/**
 * Duration ceiling in seconds, for the kinds that have one. The client reads
 * the duration off the decoded file and sends it; a client that sends nothing
 * is size-capped only, which is why the size limits above are the real
 * backstop.
 */
export const TRACK_MEDIA_DURATION_LIMITS: Partial<
  Record<TrackMediaKind, number>
> = {
  [TrackMediaKind.VIDEO]: TRACK_VIDEO_FILE_DURATION_LIMIT,
  [TrackMediaKind.QUESTION_VIDEO]: TRACK_QUESTION_VIDEO_DURATION_LIMIT,
};

/**
 * Trainer-written prompt for an AI course cover (Track settings → Generate).
 * The editor's default prompt — house style, safety rules and a course excerpt
 * — runs to roughly a thousand characters; the ceiling leaves room to rewrite
 * it at length without letting a pasted document through to the provider.
 */
export const TRACK_COVER_PROMPT_MIN_LENGTH = 10;
export const TRACK_COVER_PROMPT_MAX_LENGTH = 4_000;

/** 3:2 landscape, the size Course Copilot and the roleplay covers render at. */
export const TRACK_COVER_IMAGE_SIZE = '1536x1024';

/**
 * Alt text is a short description of what the picture shows, not a caption
 * and not a second prompt. Long enough for "a swollen left ankle, bruised
 * along the outer malleolus"; short enough that a screen-reader user isn't
 * read an essay before reaching the answer options.
 */
export const TRACK_MAX_QUESTION_MEDIA_ALT_LENGTH = 300;

/** Per-question timeout for LLM grading of open-ended quiz answers. */
export const TRACK_QUIZ_LLM_GRADING_TIMEOUT_MS = 20_000;

/**
 * Evaluated ROLEPLAY sessions a skillCoverage category needs, within one
 * course, before its average is trusted enough to classify. One session is
 * one LLM judge's read of one conversation; the spread between a learner's
 * adjacent sessions is routinely tens of points. Below this,
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
