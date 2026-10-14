import { TrackItemType } from 'src/track/type/track.type';

/**
 * The distilled interview — what the trainer has told the copilot so far.
 *
 * Patched field by field by the `update_brief` tool and read by every
 * specialist as its shared context, so nothing the trainer said is allowed to
 * fall out of it: anything that fits no field goes in `notes`.
 *
 * Every field is optional at rest because the brief starts empty and fills in
 * over the interview. `propose_blueprint` refuses until the readiness fields
 * (see CourseCopilotBriefService.readiness) are present.
 */
export interface CourseBrief {
  /** The trainer's own words for what the course is for. */
  seed?: string;
  audience?: {
    who?: string;
    priorExperience?: string;
    applicationContext?: string;
    groupNote?: string;
  };
  /** Observable verbs: "de-escalate a caller who threatens to hang up". */
  outcomes?: { terminal?: string; enabling?: string[] };
  competencyIds?: string[];
  competencyNames?: string[];
  behaviours?: { helpful?: string[]; unhelpful?: string[] };
  assessment?: {
    kind?: CourseBriefAssessmentKind;
    note?: string;
    threshold?: number;
  };
  shape?: {
    durationMinutes?: number;
    sections?: number;
    practiceWeight?: 'practice-heavy' | 'balanced' | 'reading-heavy';
    components?: CourseBriefComponent[];
    tone?: string;
    readingLevel?: string;
    /** Numeric `languages.id` values, as strings. */
    languageIds?: string[];
  };
  practice?: CourseBriefPracticeSlot[];
  look?: {
    cover?: 'generate' | 'library' | 'upload-later';
    coverImageUrl?: string;
    articleImages?: 'none' | 'cover-only' | 'one-per-article';
  };
  videoUrls?: CourseBriefVideo[];
  notes?: string[];
}

export type CourseBriefAssessmentKind =
  | 'roleplay'
  | 'quiz'
  | 'annotated_artifact'
  | 'journal';

export type CourseBriefComponent =
  | 'article'
  | 'video'
  | 'journal'
  | 'annotated_artifact'
  | 'game'
  | 'quiz';

export interface CourseBriefPracticeSlot {
  slot: number;
  source: 'library' | 'new';
  scenarioId?: number;
  caseId?: string;
  characterId?: string;
  personaBrief?: string;
  /** The simplifying condition this slot varies: "cooperative caller, one concern". */
  taskClass?: string;
  minScore?: number;
  triggerWarningIds?: string[];
  /** Also save a generated persona to the Character Library for reuse. */
  saveCharacter?: boolean;
}

export interface CourseBriefVideo {
  title: string;
  url: string;
  source: 'youtube' | 'vimeo' | 'loom' | 's3';
  durationSeconds?: number;
}

export interface CourseBriefReadiness {
  ready: boolean;
  /** Human-readable names of the fields still missing. */
  missing: string[];
}

/** The item types the copilot can put in a course — exactly TrackItemType. */
export type CourseBlueprintItemType = `${TrackItemType}`;

export type CourseBlueprintItemSource =
  | { kind: 'new' }
  | {
      kind: 'library';
      scenarioId?: number;
      caseId?: string;
      templateId?: string;
    }
  | { kind: 'needs-input'; what: 'video-url' };

export interface CourseBlueprintCompletionCriteria {
  minScore?: number;
  passScore?: number;
  watchPct?: number;
  minReadSeconds?: number;
  minDurationSeconds?: number;
}

export interface CourseBlueprintItem {
  /** Stable across patches; the key every job and the id map use. */
  id: string;
  type: CourseBlueprintItemType;
  title: string;
  purpose: string;
  /** Indexes into `brief.outcomes.enabling`. */
  objectiveRefs: number[];
  estimatedMinutes: number;
  source: CourseBlueprintItemSource;
  /**
   * Per-type generation brief. Quiz: questionCount, questionTypes, difficulty,
   * includeSelfRating. Article: outline, wordTarget, withImage, questionCount.
   * Roleplay: personaBrief, taskClass, languageIds, minScore,
   * triggerWarningIds, characterId, saveCharacter. Case: memberItemIds.
   * Annotation: focus, behaviourLabels. Journal: focus. Game: gameKey.
   * Video: url, source, durationSeconds.
   */
  spec: Record<string, any>;
  completionCriteria?: CourseBlueprintCompletionCriteria;
  hasDiscussion?: boolean;
}

export interface CourseBlueprintSection {
  id: string;
  title: string;
  description: string;
  purpose: string;
  items: CourseBlueprintItem[];
}

export interface CourseBlueprintEstimate {
  usd: number;
  minutes: number;
  items: number;
  newRoleplays: number;
  images: number;
}

export interface CourseBlueprint {
  title: string;
  description: string;
  estimatedDurationMinutes: number;
  competencyIds: string[];
  cover: {
    mode: 'generate' | 'library' | 'upload-later';
    prompt?: string;
    imageUrl?: string;
  };
  sections: CourseBlueprintSection[];
  estimate: CourseBlueprintEstimate;
}

/**
 * One line per item in the compact outline the model and the work pane read.
 * Never carries full content — article html is the size of the whole prompt.
 */
export interface CourseOutlineItem {
  id: string;
  type: TrackItemType;
  order: number;
  title: string;
  description?: string | null;
  scenarioId?: number | null;
  caseId?: string | null;
  completionCriteria?: Record<string, any> | null;
  /** "6 questions", "820 words, 2 checks", "40 lines, 4 labels", "TREX_RUNNER". */
  size: string;
  hasDiscussion?: boolean;
}

export interface CourseOutlineSection {
  id: string;
  order: number;
  title: string;
  description?: string | null;
  items: CourseOutlineItem[];
}

export interface CourseOutline {
  trackId: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  status: string;
  estimatedDurationMinutes: number | null;
  competencyIds: string[] | null;
  /** True when learners are enrolled and structural edits will 409. */
  structureLocked: boolean;
  sections: CourseOutlineSection[];
}

/** Mirrors TrackService.validateTrackForPublish, as a checklist rather than a throw. */
export interface CoursePublishReadiness {
  ready: boolean;
  checks: { key: string; label: string; ok: boolean; detail?: string }[];
}

export interface CourseChangeLogEntry {
  at: string;
  summary: string;
  tool: string;
  itemId?: string;
  sectionId?: string;
}

/**
 * Blueprint id → real track id. `upsertStructure` cannot create a row with an
 * id the caller chose, so the first write creates without ids and this map
 * records what the server assigned; every later write is then an update.
 */
export interface CourseCopilotTrackIdMap {
  sections: Record<string, string>;
  items: Record<string, string>;
}

/** What a finished job hands to the structure writer. */
export interface CourseCopilotJobResult {
  trackItemId?: string;
  scenarioId?: number;
  caseId?: string;
  characterId?: string;
  imageUrl?: string;
  /** Inline item content, already validated by validateTrackItemContent. */
  content?: Record<string, any>;
  /** Course meta polish. */
  title?: string;
  description?: string;
  /** One-line, human summary for the build panel ("8 questions"). */
  summary?: string;
  /** Article only: what an illustration should show, for the image job. */
  imageBrief?: string;
  /** Reviewer findings (course_review). */
  findings?: CourseReviewFinding[];
  /** Why a job was skipped, when it was. */
  skippedReason?: string;
}

export interface CourseReviewFinding {
  severity: 'fix' | 'consider';
  itemId?: string;
  note: string;
  suggestedAction?: { tool: string; input: Record<string, any> };
}
