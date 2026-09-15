import { AssignmentStatus } from 'src/common/type/common.type';
import { McqSingleQuestion, QuizQuestion } from './quiz.type';

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

export interface ArticleContent {
  html: string;
  imageUrls?: string[];
  questions?: ArticleQuestion[];
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
