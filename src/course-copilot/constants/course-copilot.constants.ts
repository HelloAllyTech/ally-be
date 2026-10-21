import {
  TRACK_MAX_ITEMS_PER_SECTION,
  TRACK_MAX_SECTIONS,
} from 'src/track/constants/track.constant';
import { ScenarioCategory } from 'src/learn/enum/scenario-category.enum';
import { CourseCopilotJobKind } from '../enum/course-copilot.enum';

// ── Turn loop ───────────────────────────────────────────────────────────────

export const COURSE_COPILOT_TURN_LOCK_PREFIX = 'course-copilot-turn';
/** A turn is one question, or one blueprint plan — minutes, not hours. */
export const COURSE_COPILOT_TURN_LOCK_TTL_SECONDS = 5 * 60;
/** The planner call can sit silent for a minute; proxies drop idle streams. */
export const COURSE_COPILOT_SSE_PING_INTERVAL_MS = 15_000;
/** The blueprint is the largest tool payload, and far smaller than this. */
export const COURSE_COPILOT_INTERVIEW_MAX_TOKENS = 16_000;
export const COURSE_COPILOT_SYSTEM_PROMPT_TTL_MS = 60_000;
export const COURSE_COPILOT_MAX_TRUNCATION_RETRIES = 2;
export const COURSE_COPILOT_SUMMARY_AFTER_MESSAGES = 40;
export const COURSE_COPILOT_SUMMARY_KEEP_RECENT = 16;
export const COURSE_COPILOT_DEFAULT_MAX_TOOL_ITERATIONS = 10;
export const COURSE_COPILOT_STACKS_DEFAULT_RESULTS = 4;

// ── Build runner ────────────────────────────────────────────────────────────

export const COURSE_COPILOT_DEFAULT_CONCURRENCY = 4;
/** How often a running job proves it is alive. */
export const COURSE_COPILOT_JOB_HEARTBEAT_MS = 30_000;
/**
 * A running job silent for this long is presumed dead (a deploy, a crash).
 * Six missed heartbeats: the beat is a timer, not work, so a live job misses
 * one only when its process is gone.
 */
export const COURSE_COPILOT_JOB_STALE_MS = 3 * 60_000;
/** After boot, resume orphaned builds this soon rather than at the next tick. */
export const COURSE_COPILOT_BOOT_RECONCILE_DELAY_MS = 30_000;
/** Attempts per job: the first run plus one repair pass with the validator's errors. */
export const COURSE_COPILOT_JOB_MAX_ATTEMPTS = 2;
export const COURSE_COPILOT_BUILD_LOCK_PREFIX = 'course-copilot-build';
export const COURSE_COPILOT_STRUCTURE_LOCK_PREFIX = 'course-copilot-structure';
export const COURSE_COPILOT_STRUCTURE_LOCK_TTL_SECONDS = 60;
/** Job results that land together are written as one structure save. */
export const COURSE_COPILOT_STRUCTURE_DEBOUNCE_MS = 2_000;
export const COURSE_COPILOT_RECONCILE_TASK = 'course-copilot.reconcile';
export const COURSE_COPILOT_RECONCILE_INTERVAL = '5min';
export const COURSE_COPILOT_EVENT_PAYLOAD_MAX_BYTES = 8_192;
/** An inline item added mid-turn by an edit tool must come back within a turn. */
export const COURSE_COPILOT_INLINE_SPECIALIST_TIMEOUT_MS = 90_000;

// ── Limits (enforced in code, not only in the prompt) ──────────────────────

export const COURSE_COPILOT_LIMITS = {
  activeSessionsPerUser: 2,
  sections: Math.min(8, TRACK_MAX_SECTIONS),
  items: 40,
  itemsPerSection: Math.min(12, TRACK_MAX_ITEMS_PER_SECTION),
  newRoleplays: 4,
  newCases: 2,
  images: 12,
  languagesPerRoleplay: 4,
  competencies: 15,
  quizQuestions: 20,
  articleQuestions: 5,
  annotationUnits: 60,
  annotationLabels: 6,
  journalPrompts: 3,
  reviewFindings: 10,
} as const;

/** Durations the interview offers, minutes. Anything else is still accepted. */
export const COURSE_COPILOT_DURATION_OPTIONS = [30, 60, 120, 240];

// ── Cost ────────────────────────────────────────────────────────────────────

export const COURSE_COPILOT_DEFAULT_BUDGET_USD = 15;
/**
 * Images have no row in the pricing table by design, so the copilot counts
 * each one at a flat rate. Close enough for a ceiling; wrong for an invoice.
 */
export const COURSE_COPILOT_DEFAULT_IMAGE_COST_USD = 0.1;

/**
 * Static per-job estimates, USD. Approval is refused when the sum exceeds the
 * remaining budget, so these err high. Tune against real `llm_usage` sums
 * after a few builds (plan §10, "Cost check").
 */
export const COURSE_COPILOT_JOB_COST_ESTIMATE_USD: Record<
  CourseCopilotJobKind,
  number
> = {
  [CourseCopilotJobKind.COURSE_META]: 0.01,
  [CourseCopilotJobKind.ARTICLE]: 0.05,
  [CourseCopilotJobKind.QUIZ]: 0.08,
  [CourseCopilotJobKind.JOURNAL]: 0.01,
  [CourseCopilotJobKind.ANNOTATED_ARTIFACT]: 0.1,
  [CourseCopilotJobKind.GAME]: 0,
  [CourseCopilotJobKind.VIDEO]: 0,
  [CourseCopilotJobKind.ROLEPLAY_NEW]: 0.6,
  [CourseCopilotJobKind.ROLEPLAY_REF]: 0,
  [CourseCopilotJobKind.CASE_NEW]: 0,
  [CourseCopilotJobKind.CASE_REF]: 0,
  [CourseCopilotJobKind.COVER_IMAGE]: 0.11,
  [CourseCopilotJobKind.ARTICLE_IMAGE]: 0.11,
  [CourseCopilotJobKind.COURSE_REVIEW]: 0.1,
};
/** Each spoken language past the first adds its per-language field calls. */
export const COURSE_COPILOT_EXTRA_LANGUAGE_COST_USD = 0.15;
/** The interview itself, so a fresh session can't approve to the cent. */
export const COURSE_COPILOT_PLANNER_COST_USD = 0.1;

/** Default minutes per item type when the planner leaves one out. */
export const COURSE_COPILOT_DEFAULT_ITEM_MINUTES: Record<string, number> = {
  ARTICLE: 6,
  QUIZ: 5,
  JOURNAL: 4,
  ANNOTATED_ARTIFACT: 8,
  ROLEPLAY: 12,
  CASE: 25,
  GAME: 3,
  VIDEO: 5,
};

// ── Model calls ─────────────────────────────────────────────────────────────

/** Prompt codes: `course_copilot/<file>.txt` → `course_copilot_<file>`. */
export const COURSE_COPILOT_PROMPTS = {
  INTERVIEWER_SYSTEM: 'course_copilot_interviewer_system',
  BLUEPRINT_PLANNER: 'course_copilot_blueprint_planner',
  ARTICLE_WRITER: 'course_copilot_article_writer',
  QUIZ_WRITER: 'course_copilot_quiz_writer',
  JOURNAL_WRITER: 'course_copilot_journal_writer',
  ANNOTATION_WRITER: 'course_copilot_annotation_writer',
  COURSE_META: 'course_copilot_course_meta',
  COURSE_REVIEWER: 'course_copilot_course_reviewer',
  HISTORY_SUMMARY: 'course_copilot_history_summary',
  ROLEPLAY_BRIEF: 'course_copilot_roleplay_brief',
  IMAGE_PROMPT: 'course_copilot_image_prompt',
  LANDING_PAGE_WRITER: 'course_copilot_landing_page_writer',
} as const;

/** AI-task-registry row ids, one per call site. */
export const COURSE_COPILOT_AI_TASKS = {
  INTERVIEW: 'course-copilot-interview',
  BLUEPRINT: 'course-copilot-blueprint',
  ARTICLE: 'course-copilot-article',
  QUIZ: 'course-copilot-quiz',
  JOURNAL: 'course-copilot-journal',
  ANNOTATION: 'course-copilot-annotation',
  META: 'course-copilot-meta',
  REVIEW: 'course-copilot-review',
  SUMMARY: 'course-copilot-summary',
  ROLEPLAY_BRIEF: 'course-copilot-roleplay-brief',
  IMAGE_PROMPT: 'course-copilot-image-prompt',
  IMAGE: 'course-copilot-image',
  LANDING_PAGE: 'course-copilot-landing-page',
} as const;

/** Category every generated roleplay carries, so the library can filter them. */
export const COURSE_COPILOT_SCENARIO_CATEGORY = ScenarioCategory.COURSE_COPILOT;

/** Where generated images land — the same prefix the editor's uploads use. */
export const COURSE_COPILOT_MEDIA_PREFIX = 'track-media/image';
