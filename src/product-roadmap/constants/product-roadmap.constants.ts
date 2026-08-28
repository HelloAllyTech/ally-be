import { RoadmapOpportunityStage } from '../enum/roadmap-opportunity.enum';
import { TIME } from 'src/common/constants/time.constants';

/**
 * Product Roadmap limits and tuning. Every length limit here has a matching CHECK
 * constraint in migration 1871000000000 — the DTO gives a friendly 400, the CHECK makes a
 * bad row impossible. Keep the two in sync.
 */

/**
 * Votes each user may cast per calendar month. Unused votes LAPSE — there is no rollover;
 * the period key simply changes. Mirrored on the frontend, and enforced by both
 * roadmap_enforce_monthly_cap() and RoadmapAllocationService.
 */
export const VOTES_PER_MONTH = 100;

/**
 * The `productGoal` every bug report is filed under. `productGoal` is a required text
 * FK-by-name into `roadmap_product_goals` (see the entity) and no bug-report form has a
 * goal/category picker (product decision — see CreateBugReportDto), so something has to be
 * chosen server-side. 'Reliability & Trust' already exists in the seeded taxonomy
 * (migration 1871000000002) and is the closest semantic fit for an unclassified bug. It is
 * near-invisible in practice: bugs no longer render on the roadmap board at all, so this is
 * really just satisfying the column's FK.
 */
export const BUG_REPORT_DEFAULT_PRODUCT_GOAL = 'Reliability & Trust';

/**
 * Per-user throttle on POST /product-roadmap/bug-reports, keyed by `userId` (not IP, since
 * every caller is authenticated) via CustomThrottlerGuard. 8/hour is generous enough for a
 * genuinely frustrated user filing a few reports in a session while still bounding a
 * scripted-spam or retry-loop client — there is no product-defined cadence for this today
 * (Stacks search turned up nothing Ally-specific), so this is a judgement call, easy to
 * retune later since it is not read anywhere else.
 *
 * Applies to internal reporters too, now that the admin roadmap's "Report a bug" button
 * uses this same route. A staff member hitting 8 reports in an hour is the same runaway
 * client this bounds, and nothing about being internal makes that safe.
 */
export const BUG_REPORT_RATE_LIMIT = {
  LIMIT: 8,
  TTL_MS: TIME.HOUR_IN_MS,
} as const;

/**
 * How much of an opportunity's description becomes the Builder session title.
 *
 * Builder derives its branch slug from the title, so this is a readability bound, not a storage
 * one — BuilderSessionService truncates to its own BUILDER_TITLE_MAX_LENGTH regardless. 80 is
 * about a headline's worth, which is what a branch name and a session list can both carry.
 */
export const BUILDER_SEED_TITLE_MAX = 80;

export const ROADMAP_LIMITS = {
  DESCRIPTION_MAX: 1000,
  PRD_MAX: 20000,
  CLAUDE_PROMPT_MAX: 20000,
  COMMENT_MAX: 500,
  INTERVIEW_TITLE_MAX: 200,
  INTERVIEW_SUMMARY_MAX: 5000,
  /** Cap on transcript text handed to the LLM for summarisation. */
  INTERVIEW_TRANSCRIPT_MAX: 50000,
  SAVED_VIEW_NAME_MAX: 100,
  GOAL_NAME_MAX: 200,
  OWNER_NAME_MAX: 200,
} as const;

/**
 * The stages that make up THE QUEUE — the working pipeline.
 *
 * A single list: everything still in play, ordered by total votes. Released and archived are out
 * because they are records rather than work. This drives both the queue's stage filter and the
 * queue-rank window (see QUEUE_RANK_SQL), so the ranked population and the filtered population
 * cannot drift apart.
 */
export const ROADMAP_QUEUE_STAGES = [
  RoadmapOpportunityStage.NEW,
  RoadmapOpportunityStage.PRIORITISED,
  RoadmapOpportunityStage.UNDER_DEVELOPMENT,
] as const;

export const ROADMAP_LIST_DEFAULTS = {
  LIMIT: 50,
  /**
   * Hard ceiling on one list response. Raised from 200 when the list view replaced pagination
   * with "Load more": that button grows `limit` rather than walking `offset`, so the ceiling is
   * now the point at which loading more stops working.
   *
   * The repository CLAMPS silently (`Math.min(limit, MAX_LIMIT)`) rather than rejecting, so
   * exceeding this does not error — it just returns fewer rows than asked for, which on the
   * client looks like a button that does nothing. The client mirrors this number so it can say
   * so instead; if you change it here, change it there (utils/paging.ts).
   *
   * 500 is chosen against the real population: the whole board is ~430 rows today, so this
   * covers loading everything in one view with room to grow, while still bounding a response.
   */
  MAX_LIMIT: 500,
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
  READINESS_CHECK: 'roadmap_readiness_check',
  REVIEW_DRAFT: 'roadmap_review_draft',
  ENHANCE_DRAFT: 'roadmap_enhance_draft',
  CLASSIFY_GOAL: 'roadmap_classify_goal',
  DUPLICATE_CHECK: 'roadmap_duplicate_check',
  SUMMARISE_INTERVIEW: 'roadmap_summarise_interview',
  GENERATE_CLAUDE_PROMPT: 'roadmap_generate_claude_prompt',
} as const;

/**
 * The readiness checklist the "Check readiness" button grades a draft against, and the gate on
 * filing: every item must come back green before the opportunity can be filed.
 *
 * SEED LIST — expected to change. It lives here, server-side, as the single source of truth:
 * the admin drawer renders whatever this returns rather than holding its own copy, so editing
 * this array is the whole change. The ids are the join key between the criteria the UI shows
 * and the verdicts the model returns, so treat an id as permanent once shipped — renaming one
 * silently drops its verdict and fails that item closed.
 *
 * The four here are the gatekeeping questions the team's own discovery guidance applies before
 * an opportunity earns a place on the tree (Stacks: "Filter opportunities by specificity and
 * validation criteria"): framed as a need rather than a solution, specific rather than a theme,
 * attributable to more than one person, and tied to an outcome.
 */
export const ROADMAP_READINESS_CRITERIA = [
  {
    id: 'problem_not_solution',
    label: 'Describes a problem, not a solution',
    hint: 'Framed as a need, pain point or desire — not the feature you would build for it.',
  },
  {
    id: 'specific',
    label: 'Specific enough to act on',
    hint: 'One narrow problem, not a broad theme like "the interface is hard to use".',
  },
  {
    id: 'who_it_affects',
    label: 'Names who hits it',
    hint: "Says whose problem this is, and that it is more than one person's opinion.",
  },
  {
    id: 'outcome',
    label: 'Says what solving it changes',
    hint: 'The impact — what those people would be able to do, or stop losing.',
  },
] as const;

/**
 * Marker raised by roadmap_enforce_monthly_cap(). The trigger's SQLSTATE is P0001, which
 * every RAISE EXCEPTION in the database shares, so the service keys off this prefix to
 * distinguish a cap breach from an unrelated failure. Changing it requires changing
 * migration 1871000000001 too.
 */
export const ROADMAP_CAP_ERROR_MARKER = 'ROADMAP_MONTHLY_CAP_EXCEEDED';

/** Advisory-lock namespace for serialising a user's allocation writes within a period. */
export const ROADMAP_ALLOCATION_LOCK_NAMESPACE = 'roadmap:allocation';
