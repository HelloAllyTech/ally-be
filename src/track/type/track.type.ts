import { AssignmentStatus } from 'src/common/type/common.type';
import { McqSingleQuestion, QuizQuestion } from './quiz.type';
import { BranchingRun } from './branching.type';
import { BucketSortAnswer } from './bucket-sort.type';

export enum TrackStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export enum TrackItemType {
  ROLEPLAY = 'ROLEPLAY',
  CASE = 'CASE',
  QUIZ = 'QUIZ',
  ARTICLE = 'ARTICLE',
  VIDEO = 'VIDEO',
  JOURNAL = 'JOURNAL',
  ANNOTATED_ARTIFACT = 'ANNOTATED_ARTIFACT',
  GAME = 'GAME',
  BRANCHING_SCENARIO = 'BRANCHING_SCENARIO',
  BUCKET_SORT = 'BUCKET_SORT',
}

/**
 * Why a signed-in learner cannot take a course. Returned by the access check
 * behind a shared course link, so the landing page can say "not available"
 * without the learner first hitting a 403 mid-flow.
 */
export enum TrackAccessDenialReason {
  /** Deleted, never published, or archived with no enrolment to finish. */
  NOT_AVAILABLE = 'NOT_AVAILABLE',
  /** The learner's account carries no organisation. */
  NO_ORGANIZATION = 'NO_ORGANIZATION',
  /** The course is not assigned to the learner's organisation. */
  NOT_IN_ORGANIZATION = 'NOT_IN_ORGANIZATION',
  /** Assigned to the organisation, but restricted away from their group. */
  NOT_IN_GROUP = 'NOT_IN_GROUP',
}

export enum TrackProgressionMode {
  SEQUENTIAL = 'SEQUENTIAL',
}

export enum TrackSectionUnlockRule {
  SEQUENTIAL = 'SEQUENTIAL',
}

export enum TrackSortBy {
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
}

export enum TrackSortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export enum VideoSource {
  S3 = 's3',
  YOUTUBE = 'youtube',
  VIMEO = 'vimeo',
  LOOM = 'loom',
}

export interface TrackFilterOptions {
  status?: string[];
  limit?: number;
  offset?: number;
  search?: string;
  tenantId?: string;
  /** Only meaningful together with tenantId; ignored without it. */
  assignmentStatus?: AssignmentStatus;
  sortBy?: TrackSortBy;
  order?: TrackSortOrder;
}

export interface TrackTranslations {
  title?: string;
  description?: string;
}

/**
 * A multiple-choice question embedded in an article's prose. The question
 * itself lives here, in `ArticleContent.questions`; where it *sits* in the
 * article is marked in the HTML by an empty
 * `<div data-ally-question="<id>"></div>` placeholder, the same
 * separate-the-key-from-the-text idea as `FillBlankQuestion.template`'s
 * `{{blankId}}` tokens. Keeping the question out of the HTML means the answer
 * key never passes through the rich-text sanitizer and never reaches the
 * learner's payload — `sanitizeQuizQuestionForLearner` strips it on the way
 * out, exactly as it does for a video interjection.
 *
 * Restricted to single-select MCQ (see `validateArticleQuestions`): an article
 * question is a reading check the learner answers in place, so anything that
 * needs LLM grading or a multi-step widget belongs in a QUIZ component.
 */
export type ArticleQuestion = McqSingleQuestion;

/**
 * A curated external link shown in the "Resources" list after an article's
 * body — supplementary reading, never required: nothing here gates
 * completion, and the player opens it in place (a modal/sheet with an
 * embedded view) rather than sending the learner out of the app, per
 * "reach curated material without leaving the course".
 */
export interface ArticleResource {
  id: string;
  title: string;
  url: string;
}

export interface ArticleContent {
  html: string;
  imageUrls?: string[];
  questions?: ArticleQuestion[];
  resources?: ArticleResource[];
}

/** Matches the placeholder an article question is anchored to in the HTML. */
export const ARTICLE_QUESTION_MARKER_ATTR = 'data-ally-question';

/**
 * Pull the question ids an article's HTML anchors, in reading order. Tolerant
 * of attribute order and quoting so it survives a round trip through TipTap
 * and DOMPurify.
 */
export function parseArticleQuestionMarkers(html: string): string[] {
  const pattern = new RegExp(
    `<div\\b[^>]*\\b${ARTICLE_QUESTION_MARKER_ATTR}\\s*=\\s*["']([^"']+)["'][^>]*>`,
    'gi',
  );
  const ids: string[] = [];
  let match = pattern.exec(html ?? '');
  while (match) {
    ids.push(match[1]);
    match = pattern.exec(html ?? '');
  }
  return ids;
}

/**
 * A quiz question pinned to a moment in a VIDEO item. The player hard-pauses
 * at `timestampSeconds` and requires an answer before resuming. Restricted to
 * S3-hosted video (see `validateInterjections`) since third-party embeds
 * (YouTube/Vimeo/Loom) give us no reliable playback-position control.
 */
export interface VideoInterjection {
  id: string;
  timestampSeconds: number;
  question: QuizQuestion;
}

export interface VideoContent {
  source: VideoSource;
  url: string;
  durationSeconds?: number;
  interjections?: VideoInterjection[];
}

export interface JournalPrompt {
  id: string;
  prompt: string;
  promptHtml?: string;
  required?: boolean;
  placeholder?: string;
}

export interface JournalContent {
  prompts: JournalPrompt[];
}

/**
 * Per-item completion rule. Only the keys relevant to the item's type are
 * read; the rest are ignored:
 *  - ROLEPLAY/CASE → minScore (+ minDurationSeconds for ROLEPLAY, falling back
 *    to config.simulationPath.simulationPathItemMinDurationForCompletion)
 *  - QUIZ / ANNOTATED_ARTIFACT → passScore (kept in sync with
 *    content.settings.passScore on save)
 *  - VIDEO → watchPct
 *  - ARTICLE → minReadSeconds (0 = mark-as-read only)
 *  - GAME → nothing; games never gate progression (see game.type.ts)
 *  - BUCKET_SORT → nothing; it completes once every item has been placed
 *  - BRANCHING_SCENARIO → passScore (kept in sync with
 *    content.settings.passScore on save); absent = completes on any ending
 */
export interface TrackItemCompletionCriteria {
  minScore?: number;
  minDurationSeconds?: number;
  passScore?: number;
  watchPct?: number;
  minReadSeconds?: number;
}

export interface AnsweredArticleQuestion {
  selectedOptionId: string;
  correct: boolean;
  /** ISO timestamp. */
  answeredAt: string;
}

export interface TrackItemProgressMeta {
  maxWatchedPct?: number;
  articleFirstOpenedAt?: string;
  articleReadAt?: string;
  /** GAME: the learner's best score so far. Shown back to them, never graded. */
  bestGameScore?: number;
  /** GAME: how many runs they have finished, for the same reason. */
  gamePlayCount?: number;
  /** BRANCHING_SCENARIO: finished runs; also the attempts used against maxAttempts. */
  branchingRunCount?: number;
  /** BRANCHING_SCENARIO: runs in the current round; counts against maxAttempts. */
  branchingRoundRuns?: BranchingRun[];
  /** BRANCHING_SCENARIO: highest and most recent run score (0-100). */
  branchingBestScore?: number;
  branchingLastScore?: number;
  /** BRANCHING_SCENARIO: distinct ending node ids the learner has reached. */
  branchingEndingsReached?: string[];
  /** BRANCHING_SCENARIO: choice ids of the most recent finished run. */
  branchingLastPath?: string[];
  /**
   * BUCKET_SORT: the learner's first placement of each item, keyed by
   * BucketSortItem.id. Written once per item and never rewritten, so it stays
   * the record of what they believed before the feedback.
   */
  bucketSortAnswers?: Record<string, BucketSortAnswer>;
  /** BUCKET_SORT: best first-try score across rounds (0-100), for reporting. */
  bucketSortBestFirstTryPct?: number;
  /** BUCKET_SORT: how many rounds the learner has finished. */
  bucketSortRounds?: number;
  /** VIDEO: per-interjection result, keyed by VideoInterjection.id. */
  answeredInterjections?: Record<
    string,
    { passed: boolean; pointsAwarded?: number }
  >;
  /**
   * ARTICLE: per-inline-question result, keyed by ArticleQuestion.id. Written
   * once and never rewritten — an article question is answered exactly once,
   * which is also what makes this the record the completion rule counts.
   */
  answeredArticleQuestions?: Record<string, AnsweredArticleQuestion>;
}
