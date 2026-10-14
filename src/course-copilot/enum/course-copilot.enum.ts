/**
 * Course Copilot lifecycle enums.
 *
 * A session moves through the interview, a blueprint the trainer approves, a
 * background build that fills a DRAFT course, and then an open-ended edit loop
 * over that course. EDIT mode skips straight to the last stage: it is a session
 * opened on a course that already exists.
 */
export enum CourseCopilotMode {
  /** Interview → blueprint → build a new DRAFT course. */
  CREATE = 'CREATE',
  /** Bound to an existing course from the start; edit tools only. */
  EDIT = 'EDIT',
}

export enum CourseCopilotSessionStatus {
  /** Asking the trainer questions and filling the brief. */
  INTERVIEWING = 'INTERVIEWING',
  /** A blueprint exists and is waiting for the trainer's approval. */
  AWAITING_BLUEPRINT = 'AWAITING_BLUEPRINT',
  /** Approved; the job runner is generating content into the course. */
  BUILDING = 'BUILDING',
  /**
   * The build stopped and cannot finish on its own — a job runner went silent
   * past the watchdog. Retryable; nothing generated so far is lost.
   */
  BUILD_FAILED = 'BUILD_FAILED',
  /** The course exists; the copilot changes it on request. */
  EDITING = 'EDITING',
  /** Hidden from the list. The course it made is never touched. */
  ARCHIVED = 'ARCHIVED',
}

/** Statuses that count against the per-user active-session cap. */
export const COURSE_COPILOT_ACTIVE_STATUSES: CourseCopilotSessionStatus[] = [
  CourseCopilotSessionStatus.INTERVIEWING,
  CourseCopilotSessionStatus.AWAITING_BLUEPRINT,
  CourseCopilotSessionStatus.BUILDING,
  CourseCopilotSessionStatus.BUILD_FAILED,
];

export enum CourseCopilotMessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
}

/**
 * What one build job produces. One job per blueprint item, plus the course-wide
 * jobs (meta polish, cover image, the reviewer pass).
 *
 * `game`, `video`, `roleplay_ref` and `case_ref` make no model call — they are
 * jobs anyway so every item lands in the course through the same path and the
 * build panel can show one row per item.
 */
export enum CourseCopilotJobKind {
  COURSE_META = 'course_meta',
  ARTICLE = 'article',
  QUIZ = 'quiz',
  JOURNAL = 'journal',
  ANNOTATED_ARTIFACT = 'annotated_artifact',
  GAME = 'game',
  VIDEO = 'video',
  ROLEPLAY_NEW = 'roleplay_new',
  ROLEPLAY_REF = 'roleplay_ref',
  CASE_NEW = 'case_new',
  CASE_REF = 'case_ref',
  COVER_IMAGE = 'cover_image',
  ARTICLE_IMAGE = 'article_image',
  COURSE_REVIEW = 'course_review',
}

export enum CourseCopilotJobStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  DONE = 'done',
  FAILED = 'failed',
  /** Not run: cancelled, not configured, or a job it depends on did not finish. */
  SKIPPED = 'skipped',
  /** Waiting for the trainer to raise the budget. */
  HELD = 'held',
}

/** A job in one of these will not change again without a retry. */
export const COURSE_COPILOT_SETTLED_JOB_STATUSES: CourseCopilotJobStatus[] = [
  CourseCopilotJobStatus.DONE,
  CourseCopilotJobStatus.FAILED,
  CourseCopilotJobStatus.SKIPPED,
];

/** Append-only progress log types, pushed on the socket and paged by `afterSeq`. */
export enum CourseCopilotEventType {
  BUILD_STARTED = 'build_started',
  JOB_QUEUED = 'job_queued',
  JOB_STARTED = 'job_started',
  JOB_PROGRESS = 'job_progress',
  JOB_DONE = 'job_done',
  JOB_FAILED = 'job_failed',
  JOB_SKIPPED = 'job_skipped',
  STRUCTURE_WRITTEN = 'structure_written',
  BUDGET_HOLD = 'budget_hold',
  REVIEW_READY = 'review_ready',
  BUILD_FINISHED = 'build_finished',
  BUILD_FAILED = 'build_failed',
  COURSE_CHANGED = 'course_changed',
}
