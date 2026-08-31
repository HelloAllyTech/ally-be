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
  STRATEGY_GOAL_NAME_MAX: 200,
  /** Cap on the model's justification for one goal-impact verdict. Matches the CHECK. */
  GOAL_IMPACT_REASON_MAX: 500,
} as const;

/**
 * Composite-rank tuning that is NOT admin-settable, kept here so the two places that need it
 * (the assessment service and its tests) cannot disagree.
 */
export const ROADMAP_RANK = {
  /**
   * Hard ceiling on strategy goals. The impact prompt asks for a verdict per goal in ONE call,
   * so the goal list is the thing that grows the response — and coverage gets less meaningful
   * the more goals there are (a strategy of twenty goals is not a strategy). Enforced when
   * creating a goal, with a message that says so.
   */
  MAX_STRATEGY_GOALS: 12,
  /**
   * Opportunities re-assessed per bulk run. A bound, not a target: adding a strategy goal makes
   * every rankable opportunity stale at once, and an unbounded run would bill the whole board in
   * one request and time out the HTTP call. The endpoint reports how many remain so the caller
   * can run it again rather than silently truncating.
   */
  BULK_ASSESS_LIMIT: 25,
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
  GOAL_IMPACT: 'roadmap_goal_impact',
  SUMMARISE_INTERVIEW: 'roadmap_summarise_interview',
  GENERATE_CLAUDE_PROMPT: 'roadmap_generate_claude_prompt',
} as const;

/**
 * The readiness checklist the "Check readiness" button grades a draft against, and the gate on
 * filing: every item must come back green before the opportunity can be filed.
 *
 * EXPECTED TO CHANGE. It lives here, server-side, as the single source of truth: the admin
 * drawer renders whatever this returns rather than holding its own copy, so editing this array
 * is the whole change. The ids are the join key between the criteria the UI shows and the
 * verdicts the model returns, so treat an id as permanent once shipped — renaming one silently
 * drops its verdict and fails that item closed. (Renaming is nonetheless safe to DO: verdicts
 * live in the drawer's local state for the length of one draft and are never persisted against
 * a filed row.)
 *
 * These five apply the team's discovery guidance at the point of filing (Stacks: "Filter
 * opportunities by specificity and validation criteria"), with two deliberate departures from
 * the strict reading of it:
 *
 * 1. A GAIN COUNTS, not only a pain. Stacks: "Frame customer needs as opportunities, not just
 *    problems" — the frame has to hold desires and delights, or the checklist quietly rejects
 *    every idea that adds something rather than repairing something.
 * 2. A PROPOSED SOLUTION IS ALLOWED, as long as the goal stands without it. The strict rule
 *    ("Distinguish Opportunities from Disguised Solutions") rejects any draft that names a
 *    feature, which in practice made people delete the most concrete thing they knew. What
 *    actually matters is the ORDER: strike the proposed build and there must still be a stated
 *    goal underneath. `goal_before_solution` grades that, and nothing grades solution-mention
 *    on its own.
 *
 * What is deliberately NOT here:
 * - SIZE. Graded from the effort the same call already proposes — see ROADMAP_FILEABLE_EFFORTS
 *   — so that the model cannot pass "small enough" while sizing the same draft XL.
 * - EVIDENCE ("more than one person said this"). It is a validation test, not a clarity test,
 *   and it failed real gaps spotted internally or derived from a bug report.
 * - USER-STORY FORMAT. Carried by the field placeholder and by the redraft, never gated: a
 *   clear plain-English opportunity must not be blocked over its shape, and criteria 3-5
 *   already grade the content the format would carry.
 */
export const ROADMAP_READINESS_CRITERIA = [
  {
    id: 'pain_or_gain',
    label: 'Names a real pain or a real gain',
    hint: 'A hurt to remove or a win to add for someone — not an activity ("add a dashboard", "use AI here") with no stated benefit.',
  },
  {
    id: 'goal_before_solution',
    label: 'Leads with the goal, not the build',
    hint: 'Naming a possible solution is fine. Strike it, and the entry must still say what we are trying to achieve.',
  },
  {
    id: 'specific',
    label: 'Narrow enough to act on',
    hint: 'One situation at one moment — not a theme like "onboarding is confusing" or "the interface is hard to use".',
  },
  {
    id: 'who_it_affects',
    label: 'Names the user group it affects',
    hint: 'Which users — counsellors, learners mid-track, admins of one tenant — not "users" in general.',
  },
  {
    id: 'outcome',
    label: 'Says what changes for them',
    hint: 'What that group can then do, stop losing, or gain — stated so we could later tell whether it happened.',
  },
] as const;

/**
 * The sizes an opportunity may be filed at. Anything larger is not one opportunity — it is a
 * set of them, and Stacks ("Select leaf-node opportunities for iterative value delivery") is
 * explicit that value lands by solving a series of smaller ones in succession rather than
 * taking a whole set at once. So L and up BLOCK filing, with the redraft asked to narrow the
 * draft to a single shippable slice.
 *
 * Served to the drawer alongside the criteria so the threshold lives in one place; the drawer
 * renders it as a sixth checklist row rather than as a hidden rule that greys out the button
 * for no visible reason.
 *
 * Sized against the effort currently in the field, which the filer may correct: the model
 * sizes from prose and gets it wrong both ways, and a gate a human cannot answer to is a gate
 * people route around by writing vaguer drafts. Correcting the size to something fileable is
 * an explicit act, visible in the row that turns green.
 */
export const ROADMAP_FILEABLE_EFFORTS = ['s', 'm'] as const;

/**
 * Marker raised by roadmap_enforce_monthly_cap(). The trigger's SQLSTATE is P0001, which
 * every RAISE EXCEPTION in the database shares, so the service keys off this prefix to
 * distinguish a cap breach from an unrelated failure. Changing it requires changing
 * migration 1871000000001 too.
 */
export const ROADMAP_CAP_ERROR_MARKER = 'ROADMAP_MONTHLY_CAP_EXCEEDED';

/** Advisory-lock namespace for serialising a user's allocation writes within a period. */
export const ROADMAP_ALLOCATION_LOCK_NAMESPACE = 'roadmap:allocation';
