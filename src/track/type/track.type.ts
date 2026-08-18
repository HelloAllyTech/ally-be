import { AssignmentStatus } from 'src/common/type/common.type';

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

export interface ArticleContent {
  html: string;
  imageUrls?: string[];
}

export interface VideoContent {
  source: VideoSource;
  url: string;
  durationSeconds?: number;
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

export interface TrackItemProgressMeta {
  maxWatchedPct?: number;
  articleFirstOpenedAt?: string;
  articleReadAt?: string;
  /** GAME: the learner's best score so far. Shown back to them, never graded. */
  bestGameScore?: number;
  /** GAME: how many runs they have finished, for the same reason. */
  gamePlayCount?: number;
}
