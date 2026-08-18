import { TIME } from 'src/common/constants/time.constants';

/**
 * Product Roadmap limits and tuning. Every length limit here has a matching CHECK
 * constraint in migration 1871000000000 — the DTO gives a friendly 400, the CHECK makes a
 * bad row impossible. Keep the two in sync.
 */

/**
 * Coins each user may allocate per calendar month. Unspent coins LAPSE — there is no
 * rollover; the period key simply changes. Mirrored on the frontend, and enforced by both
 * roadmap_enforce_monthly_cap() and RoadmapAllocationService.
 */
export const COINS_PER_MONTH = 100;

/**
 * The `productGoal` a consumer bug report is filed under. `productGoal` is a required
 * text FK-by-name into `roadmap_product_goals` (see the entity) and the consumer flow
 * deliberately has no goal/category picker (product decision — see
 * CreateConsumerBugReportDto), so something has to be chosen server-side. 'Reliability &
 * Trust' already exists in the seeded taxonomy (migration 1871000000002) and is the closest
 * semantic fit for an unclassified bug; staff can always re-triage the goal from the drawer
 * like any other opportunity.
 */
export const CONSUMER_BUG_REPORT_PRODUCT_GOAL = 'Reliability & Trust';

/**
 * Per-user throttle on POST /product-roadmap/bug-reports, keyed by `userId` (not IP, since
 * every caller is authenticated) via CustomThrottlerGuard. 8/hour is generous enough for a
 * genuinely frustrated user filing a few reports in a session while still bounding a
 * scripted-spam or retry-loop client — there is no product-defined cadence for this today
 * (Stacks search turned up nothing Ally-specific), so this is a judgement call, easy to
 * retune later since it is not read anywhere else.
 */
export const CONSUMER_BUG_REPORT_RATE_LIMIT = {
  LIMIT: 8,
  TTL_MS: TIME.HOUR_IN_MS,
} as const;

export const ROADMAP_LIMITS = {
  DESCRIPTION_MAX: 1000,
  PRD_MAX: 20000,
  CLAUDE_PROMPT_MAX: 20000,
  COMMENT_MAX: 500,
  INTERVIEW_TITLE_MAX: 200,
  INTERVIEW_SUMMARY_MAX: 5000,
  /** Cap on transcript text handed to the LLM for summarisation. */
  INTERVIEW_TRANSCRIPT_MAX: 50000,
  RELEASE_NOTE_CONTENT_MAX: 20000,
  RELEASE_NOTE_TITLE_MAX: 200,
  SAVED_VIEW_NAME_MAX: 100,
  GOAL_NAME_MAX: 200,
  OWNER_NAME_MAX: 200,
} as const;

export const ROADMAP_LIST_DEFAULTS = {
  LIMIT: 50,
  MAX_LIMIT: 200,
} as const;

/**
 * Month board tuning.
 *
 * The default window is asymmetric on purpose. One month back is enough to see what just
 * shipped without turning the board into an archive; four forward is about as far as this team
 * actually commits, and a board of empty lanes reads as a plan nobody has made. The window is a
 * READ concern only — nothing stops a card being planned into a month outside it, and the
 * response reports `bounds` so the UI can say so rather than silently hiding the card.
 *
 * MAX_ROWS is a safety bound, not a product limit: at a few hundred opportunities the whole
 * board fits comfortably, and if it is ever hit the response says so via `truncated` instead of
 * quietly dropping lanes.
 */
export const ROADMAP_BOARD_DEFAULTS = {
  WINDOW_MONTHS_BACK: 1,
  WINDOW_MONTHS_FORWARD: 4,
  /** How far a prev/next click moves the window. */
  WINDOW_STEP_MONTHS: 3,
  LANE_LIMIT: 50,
  MAX_LANE_LIMIT: 200,
  MAX_ROWS: 1000,
  /** Cap on one reorder payload, so a lane rewrite cannot be unbounded. */
  MAX_LANE_IDS: 500,
} as const;

/**
 * Duplicate detection, ported from the standalone app's /api/ai/duplicates route.
 * Vector top-N then an LLM confirmation pass that returns at most MAX_CONFIRMED.
 *
 * SIMILARITY_THRESHOLD was calibrated for Voyage voyage-3-large at 1024 dimensions; the
 * Ally implementation uses OpenAI text-embedding-3-small at 1536, so this needs
 * re-calibrating against real data on staging before it is trusted.
 */
export const ROADMAP_DUPLICATES = {
  CANDIDATE_LIMIT: 20,
  SIMILARITY_THRESHOLD: 0.5,
  MAX_CONFIRMED: 3,
} as const;

/**
 * Prompt codes resolved through PromptSharedService. Files live at
 * src/prompts/roadmap/<name>.txt and are synced into the `prompts` table at boot by
 * PromptsSyncService, which derives the code as `<subdir>_<filename>`. Editing them in the
 * Prompt Management dashboard sets useDashboardOverride and creates a version row, so
 * admins get runtime editability without a bespoke settings table.
 */
export const ROADMAP_PROMPT_CODES = {
  REVIEW_DRAFT: 'roadmap_review_draft',
  ENHANCE_DRAFT: 'roadmap_enhance_draft',
  CLASSIFY_GOAL: 'roadmap_classify_goal',
  DUPLICATE_CHECK: 'roadmap_duplicate_check',
  SUMMARISE_INTERVIEW: 'roadmap_summarise_interview',
  RELEASE_NOTES: 'roadmap_release_notes',
  GENERATE_CLAUDE_PROMPT: 'roadmap_generate_claude_prompt',
} as const;

/**
 * Marker raised by roadmap_enforce_monthly_cap(). The trigger's SQLSTATE is P0001, which
 * every RAISE EXCEPTION in the database shares, so the service keys off this prefix to
 * distinguish a cap breach from an unrelated failure. Changing it requires changing
 * migration 1871000000001 too.
 */
export const ROADMAP_CAP_ERROR_MARKER = 'ROADMAP_MONTHLY_CAP_EXCEEDED';

/** Advisory-lock namespace for serialising a user's allocation writes within a period. */
export const ROADMAP_ALLOCATION_LOCK_NAMESPACE = 'roadmap:allocation';
