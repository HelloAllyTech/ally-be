import { RoadmapOpportunityStage } from '../enum/roadmap-opportunity.enum';
import { TIME } from 'src/common/constants/time.constants';

/**
 * Product Roadmap limits and tuning. Every length limit here has a matching CHECK
 * constraint in migration 1871000000000 — the DTO gives a friendly 400, the CHECK makes a
 * bad row impossible. Keep the two in sync.
 */

/**
 * Vote grant tuning — replaces the old flat VOTES_PER_MONTH cap with three independently
 * expiring credit streams instead of one number that resets on the 1st:
 *
 *  - ROADMAP_VOTE_GRANT_MONTHLY new votes on the 1st of every UTC calendar month
 *  - ROADMAP_VOTE_GRANT_DAILY   new votes every UTC calendar day
 *  - each grant spendable for ROADMAP_VOTE_GRANT_EXPIRY_DAYS days from issuance, then it lapses
 *    unused — there is no rollover, and no way to "save up" past 30 days
 *
 * Issued by RoadmapVoteGrantSchedulerRegistrationService ('daily'/'monthly' scheduler
 * intervals), spent FIFO-by-expiry by RoadmapAllocationService, and validated as a backstop by
 * roadmap_enforce_vote_grant_balance() (migration 1962100000000). See RoadmapVoteGrant's
 * docblock for the full ledger shape.
 */
export const ROADMAP_VOTE_GRANT_MONTHLY = 50;
export const ROADMAP_VOTE_GRANT_DAILY = 5;
export const ROADMAP_VOTE_GRANT_EXPIRY_DAYS = 30;

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

/**
 * How much of the filing interview the Builder hand-off carries, in characters.
 *
 * Bounded here, by the side that knows the transcript's shape, so that an over-long one loses
 * its middle — the hand-off keeps the opening ask and the most recent turns, where the
 * decisions landed. Left to Builder's own cap (BUILDER_HANDOFF_CONTEXT_MAX, which is larger),
 * it would be cut from the end, which is exactly the part worth keeping. A ten-minute interview
 * is around 10–15k characters; this is for an unusually long one.
 */
export const BUILDER_HANDOFF_TRANSCRIPT_MAX = 80_000;

export const ROADMAP_LIMITS = {
  DESCRIPTION_MAX: 1000,
  PRD_MAX: 20000,
  CLAUDE_PROMPT_MAX: 20000,
  COMMENT_MAX: 500,
  INTERVIEW_TITLE_MAX: 200,
  INTERVIEW_SUMMARY_MAX: 5000,
  /** Cap on transcript text handed to the LLM for summarisation. */
  INTERVIEW_TRANSCRIPT_MAX: 50000,
  /**
   * One turn of the opportunity copilot. The transcript rides on every request because the
   * interview is deliberately stateless (no session table), so these two caps are what stop a
   * long conversation turning into an unbounded prompt.
   *
   * 60 messages is ~30 exchanges — past even a copilot that keeps pushing after the five
   * criteria are met, so hitting it means something is wrong rather than that someone was
   * thorough.
   */
  OPPORTUNITY_INTERVIEW_MESSAGE_MAX: 60,
  OPPORTUNITY_INTERVIEW_CONTENT_MAX: 4000,
  SAVED_VIEW_NAME_MAX: 100,
  GOAL_NAME_MAX: 200,
  OWNER_NAME_MAX: 200,
  STRATEGY_GOAL_NAME_MAX: 200,
  /** Cap on the model's justification for one goal-impact verdict. Matches the CHECK. */
  GOAL_IMPACT_REASON_MAX: 500,
  /**
   * How many reference images one opportunity may carry.
   *
   * Six, because these are evidence rather than a gallery: the screenshot of the broken screen,
   * the mock of the fixed one, and a handful of variants is the whole use. A cap exists at all
   * because the array rides the shared opportunity response — every board read pays for it —
   * and because an unbounded list is an unbounded list of S3 objects nothing ever prunes.
   * Enforced by the DTO (friendly 400) and by CHK_roadmap_opportunities_reference_images.
   */
  REFERENCE_IMAGES_MAX: 6,
  /** Caption length. A label under a thumbnail — "current state", not a paragraph. */
  REFERENCE_IMAGE_CAPTION_MAX: 200,
} as const;

/**
 * The opportunity copilot: the guided interview, given research tools and the strategy page.
 *
 * Bounds, not tuning knobs. Every number here exists to stop one turn becoming unbounded in a
 * different dimension — tool round-trips, wall-clock, or the size of what a filed row carries.
 */
export const ROADMAP_COPILOT = {
  /**
   * Research round-trips in one turn before the copilot is made to answer with what it has.
   * Eight is two or three lookups per lens on a first turn; later turns need far fewer because
   * what was found rides back in the brief. Hitting the cap is not an error — the last pass
   * runs with only `submit_turn` available, so the admin still gets a turn.
   */
  MAX_TOOL_ITERATIONS: 8,
  /** Per model pass. A pass that has not answered in this long is not going to. */
  PASS_TIMEOUT_MS: 120_000,
  /**
   * Thinking and the `submit_turn` call share this. The brief alone can run to ~2k tokens at
   * its caps, and an adaptive-thinking model spends from the same allowance before it writes.
   */
  MAX_TOKENS: 16_000,
  /** Keep-alive on the SSE stream; a turn that researches for 40s otherwise emits nothing. */
  SSE_PING_MS: 15_000,
  /** One tool result handed back to the model — a whole file is never what it needs. */
  TOOL_RESULT_MAX_CHARS: 12_000,
  /** How many board rows the always-loaded context lists, highest-ranked first. */
  BOARD_SNAPSHOT_ROWS: 25,
} as const;

/**
 * Caps on the copilot's brief. Applied by `normaliseOpportunityBrief` to whatever the model
 * wrote AND to whatever a client sends back, because the brief rides on every turn and is
 * stored on the filed row — an uncapped list is an unbounded jsonb column nobody asked for.
 */
export const ROADMAP_BRIEF_LIMITS = {
  TEXT_MAX: 600,
  SHORT_TEXT_MAX: 200,
  STRATEGIC_FIT_MAX: 4,
  EVIDENCE_MAX: 10,
  ASSUMPTIONS_MAX: 5,
  ALTERNATIVES_MAX: 5,
  RECOMMENDATIONS_MAX: 5,
} as const;

/**
 * The `global_settings` row holding the roadmap's Vision & strategy page.
 *
 * A settings row rather than a table: it is one document, edited by a handful of people a few
 * times a quarter, and global_settings is already where single platform-wide documents live
 * (legal pages, the WhatsApp bot). Its shape is RoadmapStrategyContext.
 */
export const ROADMAP_STRATEGY_CONTEXT_SETTING = 'roadmap_strategy_context';

/**
 * Per-field caps on the Vision & strategy page. Generous for a document a person writes, and
 * still small enough that the whole page fits comfortably in every copilot turn's cached prefix.
 */
export const ROADMAP_STRATEGY_CONTEXT_LIMITS = {
  VISION_MAX: 3000,
  AUDIENCE_MAX: 3000,
  BETS_MAX: 5000,
  NON_GOALS_MAX: 3000,
  METRICS_MAX: 3000,
} as const;

/**
 * Where reference images land in the assets bucket, and the ceiling on one upload.
 *
 * The prefix is load-bearing, not cosmetic: `assertOwnReferenceImages` requires every stored URL
 * to resolve to this bucket and this prefix, so a caller cannot use the images array to park an
 * arbitrary third-party URL (or one pointing at another feature's objects) on a row that every
 * roadmap viewer then loads in their browser. Changing it orphans nothing already stored — the
 * guard admits any key under the prefix, and existing rows keep the keys they have — but it does
 * mean older uploads would stop validating on a later edit, so treat it as append-only.
 *
 * 5 MB matches the blog's image cap. A screenshot is well under it; a photo off a phone is not
 * always, which is why it is not tighter.
 */
export const ROADMAP_REFERENCE_IMAGE_S3_PREFIX = 'roadmap/reference-images';
export const ROADMAP_REFERENCE_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;

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
  CLASSIFY_GOAL: 'roadmap_classify_goal',
  DUPLICATE_CHECK: 'roadmap_duplicate_check',
  GOAL_IMPACT: 'roadmap_goal_impact',
  SUMMARISE_INTERVIEW: 'roadmap_summarise_interview',
  GENERATE_CLAUDE_PROMPT: 'roadmap_generate_claude_prompt',
  /**
   * The copilot that walks an admin to a fileable, strategically grounded draft. Grades the
   * SAME ROADMAP_READINESS_CRITERIA the filing gate grades — see the prompt file for why that
   * matters: an interview with its own private rubric can hand over a draft the gate then
   * rejects, which is the one failure this surface exists to prevent.
   *
   * A NEW code rather than an edit to `roadmap_opportunity_interview`, which it replaces: that
   * row may carry a Prompt Management override and a gpt-5-mini model pin written for a
   * single-shot JSON call, and either would silently win over a tool-using prompt.
   */
  OPPORTUNITY_COPILOT: 'roadmap_opportunity_copilot',
} as const;

/**
 * The readiness checklist the guided interview grades a draft against as it goes, and the gate
 * on filing: every item must be met before the opportunity can be filed.
 *
 * EXPECTED TO CHANGE. It lives here, server-side, as the single source of truth: the admin
 * interview renders whatever this returns rather than holding its own copy, so editing this
 * array is the whole change. The ids are the join key between the criteria the UI shows and the
 * verdicts the model returns, so treat an id as permanent once shipped — renaming one silently
 * drops its verdict and fails that item closed. (Renaming is nonetheless safe to DO: verdicts
 * live in the interview's local state for the length of one conversation and are never
 * persisted against a filed row.)
 *
 * These five apply the team's discovery guidance at the point of filing (Stacks: "Filter
 * opportunities by specificity and validation criteria"), with three deliberate departures from
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
 * 3. BROAD IS ALLOWED; VAGUE IS NOT. Stacks' specificity rule ("Frame Opportunities with
 *    Specificity, Not Themes") rules out themes, design guidelines and feelings — and counts a
 *    broad need ("finding a show to watch should be easier") among its good examples. The
 *    `specific` gate this replaced (2026-10-20) read it as NARROW — "one situation at one
 *    moment" — and, with the old S/M size cap, forced every broad but well-defined opportunity
 *    down to one slice before it could be filed. `clear_why` grades what the rule is for: the
 *    entry is sharp about why it matters. Whether that why serves Ally's goals stays advice —
 *    see STRATEGIC FIT below.
 *
 * What is deliberately NOT here:
 * - SIZE. Not capped — see ROADMAP_FILEABLE_EFFORTS — but a draft has to carry one, graded from
 *   the effort the same call proposes, not as a criterion of its own.
 * - EVIDENCE ("more than one person said this"). It is a validation test, not a clarity test,
 *   and it failed real gaps spotted internally or derived from a bug report. The copilot
 *   still pushes for it — it researches analytics, interview notes and findings, and records
 *   what it found in the brief — but as advice the filer can act on, never as a gate. Same
 *   for STRATEGIC FIT: the copilot judges which goal or bet the why serves, records it in the
 *   brief, and keeps recommending until the case is strong, and the admin can file whenever
 *   the five below are met.
 * - USER-STORY FORMAT. Carried by the interview's drafting, never gated: a
 *   clear plain-English opportunity must not be blocked over its shape, and `pain_or_gain`,
 *   `who_it_affects` and `outcome` already grade the content the format would carry.
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
    id: 'clear_why',
    label: 'Clear about why it matters',
    hint: 'Says why this is worth doing — what it costs to leave it, or what it unlocks — sharply enough to weigh against the rest of the board. Broad is fine; a theme or a feeling ("make it easier to use", "improve onboarding") with no stated reason is not.',
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
 * The sizes an opportunity may be filed at: all of them. An opportunity does not have to be
 * narrow to be well defined, so size is information for voters and for the board's ranking
 * (which already scores L and up lower), not a gate. Until 2026-10-20 only S and M could be
 * filed (after Stacks' "Select leaf-node opportunities for iterative value delivery"), which
 * meant the interview withheld every broad idea and asked which single slice to keep; slicing
 * is now the team's call when they pick it up, not a precondition for putting it on the board.
 *
 * What still blocks is UNSIZED: a draft nobody can put any size on is not yet well defined
 * enough to vote on. The interview withholds it and asks what is in and out of scope, and
 * `POST /opportunities` refuses a filing with no effort.
 *
 * Served alongside the criteria so the rule lives in one place. Applied to the effort being
 * FILED, not the one in the token, so it holds whatever a client sends.
 */
export const ROADMAP_FILEABLE_EFFORTS = ['s', 'm', 'l', 'xl', 'xxl'] as const;

/**
 * Sentinel the effort FILTER accepts alongside the real RoadmapOpportunityEffort values, to mean
 * "opportunities nobody has sized" — i.e. `effort IS NULL`. Not a member of the enum itself:
 * `effort` on the entity is nullable and NULL is not a size, so widening the enum to include it
 * would let a row's own `effort` column be set to the string "unsized", which is not what "not
 * sized yet" means.
 */
export const ROADMAP_EFFORT_UNSIZED = 'unsized';

/**
 * How long a signed readiness verdict stays spendable.
 *
 * Generous rather than tight: the interview stays open while someone reads the draft and the
 * duplicates it may match, and every expiry costs a legitimate filer another interview turn.
 * Short enough that a token cannot be hoarded and replayed against a draft written next week.
 *
 * Expiry fails CLOSED — an expired token is refused, not waved through — so the cost of being
 * wrong here is an annoyance, never a hole. See RoadmapReadinessTokenService.
 */
export const ROADMAP_READINESS_TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * Domain-separation label mixed into the readiness signing key.
 *
 * The key is DERIVED from JWT_ACCESS_SECRET rather than being a new env var of its own: a new
 * secret means an infra change in three environments before this can ship at all, and a secret
 * that is missing in one of them fails filings closed there. Deriving keeps the deploy to code.
 *
 * The label is what stops that from being secret reuse. A readiness token and an access token
 * are signed with different keys — HMAC(jwt_secret, label) is not the jwt secret — so a readiness
 * token can never be presented as an access token, or the reverse, whatever a future bug does
 * with either verifier.
 *
 * Bump the version suffix to invalidate every token in flight (a criteria change that must not
 * be spendable against old verdicts, say). Every open interview then needs one more turn,
 * which is the intended cost.
 */
export const ROADMAP_READINESS_TOKEN_KEY_LABEL = 'roadmap-readiness-token-v1';

/**
 * Whether `POST /opportunities` REFUSES a filing that carries no readiness token at all.
 *
 * False for one release, deliberately. ally-be deploys before any client (see the deploy
 * ordering note in the wiki), so the moment this ships, the admin bundle in production is the
 * previous one — which sends no token. Refusing it would take filing down for everyone until
 * the web release lands, to enforce a rule whose whole purpose is tidiness.
 *
 * So the rollout is: ship this false, ship the client that sends tokens, watch for the
 * `filed with no readiness token` warning to stop appearing in production logs, then flip it
 * true in a follow-up release. Until it is true, a caller who simply omits the token is not
 * gated — a TAMPERED or STALE or EXPIRED token is always refused.
 */
export const ROADMAP_READINESS_REQUIRE_TOKEN = false;

/**
 * Marker raised by roadmap_enforce_vote_grant_balance(). The trigger's SQLSTATE is P0001,
 * which every RAISE EXCEPTION in the database shares, so the service keys off this prefix to
 * distinguish a balance breach from an unrelated failure. Changing it requires changing
 * migration 1962100000000 too.
 */
export const ROADMAP_VOTE_BALANCE_EXCEEDED_MARKER =
  'ROADMAP_VOTE_BALANCE_EXCEEDED';

/** Advisory-lock namespace for serialising a user's allocation writes within a period. */
export const ROADMAP_ALLOCATION_LOCK_NAMESPACE = 'roadmap:allocation';

/**
 * The opportunity owner picker's options, by email.
 *
 * Owning an opportunity is a named product-leadership responsibility, not a permission — the four
 * people below are the ones who actually drive delivery, and they are a strict subset of the
 * platform admins. Deriving the list from PLATFORM_TIER_ROLES group membership (what this
 * replaced) put every staff account in the dropdown, which made the picker a directory to scroll
 * rather than a short list of accountable owners.
 *
 * Email rather than user id because ids differ per environment; matched case-insensitively, so
 * keep these lowercase. `+admin` addressing is significant — it is a distinct account.
 *
 * Adding or removing an owner is a one-line edit here plus a deploy. That is deliberate: the set
 * changes about as often as the leadership team does, and a hardcoded list cannot silently drift
 * the way a group-derived one did. Existing assignments are NOT rewritten when someone leaves the
 * list — history should not change under a rename — but they can no longer be re-assigned to that
 * person, and RoadmapOpportunityService.assertEligibleOwner answers 422 if anyone tries.
 */
export const ROADMAP_OWNER_EMAILS: readonly string[] = [
  'sandeep.malhotra@helloally.ai',
  'ajey@helloally.ai',
  'shubham.bhoite+admin@helloally.ai',
  'gopikrishnan.sasikumar@helloally.ai',
] as const;
