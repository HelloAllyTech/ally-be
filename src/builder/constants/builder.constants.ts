import { BuilderNotificationKind } from '../enum/builder.enum';
// Per-session interview turn mutex (SET NX EX) — serializes concurrent
// /messages/stream calls so parallel turns can't interleave tool loops over
// one transcript.
export const BUILDER_TURN_LOCK_PREFIX = 'builder-turn';

// Lock TTL. A turn is one question or one round of PRD writing — minutes.
export const BUILDER_TURN_LOCK_TTL_SECONDS = 5 * 60;

// SSE keep-alive: a turn that spends 40s researching the codebase emits
// nothing, and proxies drop idle streams.
export const BUILDER_SSE_PING_INTERVAL_MS = 15_000;

export const BUILDER_MAX_TOKENS = 8192;

/**
 * How long the interviewer's system prompt is memoised.
 *
 * It was re-read from the database and the filesystem on every turn. A minute
 * of staleness after someone edits the prompt is nobody's problem; the turn
 * latency is what a person actually waits through.
 */
export const BUILDER_SYSTEM_PROMPT_TTL_MS = 60_000;

/**
 * Output cap for one interview model pass, deliberately larger than the
 * shared cap above.
 *
 * The interview writes the PRD through `update_prd`, and a tool call is
 * all-or-nothing: a patch cut off at the cap is discarded whole, so the cap
 * is not a budget here, it is a cliff. A turn that writes requirements, the
 * technical plan and the test plan together runs past 8k comfortably, and
 * every such turn used to end with the agent announcing the write and the
 * document not moving. The truncation handler below still exists because a
 * bigger cap moves the cliff rather than removing it.
 */
export const BUILDER_INTERVIEW_MAX_TOKENS = 16_000;

/**
 * How many times one turn may be cut off at the output cap before it gives
 * up and says so. Each retry tells the model what happened and asks it to
 * split the write; a third attempt that still overruns is not going to be
 * fixed by a fourth.
 */
export const BUILDER_MAX_TRUNCATION_RETRIES = 2;

/**
 * When the interview transcript starts being summarised, and how much of the
 * recent conversation is always replayed verbatim.
 *
 * Only the system blocks are prompt-cached, so the transcript is re-read at
 * full price every turn — a twenty-turn interview with heavy tool results grows
 * monotonically and costs more each time. Summarising the older half bounds
 * that. The recent window stays verbatim because the last few turns are what
 * the admin is actually responding to, and a summary of "what you just said" is
 * where compression starts doing damage.
 */
export const BUILDER_INTERVIEW_SUMMARY_AFTER_MESSAGES = 40;
export const BUILDER_INTERVIEW_SUMMARY_KEEP_RECENT = 16;

/**
 * Caps on what a single interview tool call may pull into context. These are
 * cost controls first and quality controls second: a whole-file dump crowds
 * out the reasoning space that makes the next question a good one.
 */
export const BUILDER_GITHUB_FILE_MAX_BYTES = 50_000;
export const BUILDER_GITHUB_TREE_MAX_ENTRIES = 400;
export const BUILDER_GITHUB_SEARCH_MAX_RESULTS = 20;

/** Lessons digest size fed into the system prompt. */
export const BUILDER_LESSONS_IN_CONTEXT = 20;

/**
 * Hard cap on the curated active lesson set.
 *
 * The cap is the reason curation exists at all: the context a prompt can spend
 * on lessons is fixed, so an unbounded table does not mean more memory — it
 * means the newest twenty crowd out everything learned before them. Sized so
 * the whole active set fits in one re-rank call, which is what lets retrieval
 * skip an index entirely.
 */
export const BUILDER_LESSON_ACTIVE_CAP = 80;

/** Candidates needed before an opportunistic consolidation is worth a call. */
export const BUILDER_LESSON_CANDIDATE_TRIGGER = 10;

/** Past builds offered to a new session as worked examples. */
export const BUILDER_EXEMPLARS_IN_CONTEXT = 2;

/** Exemplars considered before the re-rank picks from them. */
export const BUILDER_EXEMPLAR_CANDIDATES = 24;

/**
 * Milestone bounds for epic mode. Two is the point at which splitting means
 * anything; past six nobody can follow the series, and the review burden the
 * split was meant to reduce comes back as coordination overhead.
 */
export const BUILDER_MILESTONES_MIN = 2;
export const BUILDER_MILESTONES_MAX = 6;

/**
 * Cadence keys for the flywheel's scheduled passes. Both hourly because the
 * scheduler offers no daily tick and both no-op cheaply when idle — the
 * curator on one COUNT, the sweep on one indexed query.
 */
/** Curator mutex, so an hourly job on N pods is still one pass. */
export const BUILDER_CURATE_LOCK = 'builder-curate';
/** Slightly over the cadence: a dead pod must not hold it until the heat death. */
export const BUILDER_CURATE_LOCK_TTL_SECONDS = 70 * 60;

export const BUILDER_CURATE_INTERVAL = 'hourly';
export const BUILDER_CURATE_TASK = 'builder-lesson-curate';
export const BUILDER_OUTCOME_INTERVAL = 'hourly';
export const BUILDER_OUTCOME_TASK = 'builder-outcome-sweep';
/** The learning loop's scan of recent admin replies; daily is plenty for tens of sessions a week. */
export const BUILDER_CORRECTIONS_INTERVAL = 'daily';
export const BUILDER_CORRECTIONS_TASK = 'builder-corrections-scan';
/** Picks up eval suites a deploy cut off; cheap (one query) when nothing is stalled. */
export const BUILDER_EVAL_RESUME_INTERVAL = '5min';
export const BUILDER_EVAL_RESUME_TASK = 'builder-eval-resume';

/** Stacks retrieval defaults — small on purpose; hits are compact. */
export const BUILDER_STACKS_DEFAULT_RESULTS = 4;
export const BUILDER_STACKS_MAX_RESULTS = 10;

/**
 * Deadline on one Stacks call.
 *
 * A retrieval is one round trip to a Vercel function that embeds the query and
 * ranks a small corpus. Twenty seconds is generous for that and still short
 * enough that a wedged library costs the turn a pause rather than the turn.
 */
export const BUILDER_STACKS_TIMEOUT_MS = 20_000;

/**
 * Per-tenant session caps, mirroring the character-interview rationale: bound
 * LLM spend for org admins (a platform admin is not capped). Concurrency
 * guards a runaway client; the monthly ceiling guards steady over-use.
 */
export const BUILDER_MAX_ACTIVE_SESSIONS_PER_TENANT = 5;
export const BUILDER_MAX_SESSIONS_PER_TENANT_PER_MONTH = 50;

/** Title/slug bounds — slug is a git branch component. */
export const BUILDER_TITLE_MAX_LENGTH = 200;
export const BUILDER_SLUG_MAX_LENGTH = 80;

/**
 * Upper bound on `builder_sessions.handoffContext` — what another module hands a session
 * when it starts one (today: a roadmap opportunity's brief and filing interview).
 *
 * It rides in the cached system prefix on every interview turn, so it is paid for once per
 * cache window rather than per turn, but it is still prefix the model has to read. A
 * ten-minute filing interview renders to roughly 10–15k characters; this is headroom for a
 * long one, not a target. The column's CHECK holds the same number.
 */
export const BUILDER_HANDOFF_CONTEXT_MAX = 120_000;

/* ── Build dispatch ─────────────────────────────────────────────────────── */

/** The workflow file, hosted in ally-be — one copy, so it cannot drift. */
export const BUILDER_WORKFLOW_FILE = 'builder-session.yml';

/**
 * Review runs per pull request.
 *
 * Two, not one: the first review reads what Builder opened, and a second is
 * worth having after a fix run has rewritten part of it. Not unbounded,
 * because review → fix → new head sha → review is a loop that would otherwise
 * only stop when a human closed the pull request.
 */
/**
 * The GitHub logins Builder's own runners push and comment as.
 *
 * `isOwnActor` decides two things at once: whose comments are not feedback to
 * itself, and whose commits it may act on top of. Getting it wrong is silent in
 * both directions, and it was wrong — the predicate matched `ally-builder*` and
 * `*[bot]`, while every commit a runner pushes is authored by
 * `adminbughunterhelloallyai`.
 *
 * So Builder did not recognise its own pushes. Two features were disabled by it
 * and neither said so: a branch that fell behind was never brought up to date
 * (it looked like somebody else's work), and a failing check on Builder's own
 * commit was filed OBSERVED rather than PENDING — which `countPending` ignores,
 * so the fix loop never fired on its own red CI. The comment on `isOwnActor`
 * describes that failure exactly; the list simply did not contain the name.
 *
 * A list rather than a pattern: these are real accounts, and a prefix match is
 * how a human called `ally-builder-reviews` would quietly gain the right to
 * have their pushes overwritten.
 */
export const BUILDER_OWN_ACTORS = [
  'adminbughunterhelloallyai',
  'ally-builder',
] as const;

/**
 * The code review for an opencode pull request runs in the target repo's own
 * Actions (`builder-review.yml`, calling ally-be's builder-review-opencode.yml),
 * with the code checked out so it can prove what it reports.
 *
 * It reviews every head CI turns green: a finding goes to opencode as `/oc`,
 * opencode pushes, and the fix is reviewed in turn — one more review than the
 * per-PR fix ceiling allows.
 */
export const BUILDER_REPO_REVIEW_WORKFLOW = 'builder-review.yml';
export const BUILDER_MAX_REPO_REVIEWS_PER_PR = 4;
/** Four parallel passes and a verify pass; anything past this has hung. */
export const BUILDER_REPO_REVIEW_TIMEOUT_MS = 90 * 60_000;
/**
 * How long review-and-fix may run on one pull request, from its first review,
 * before it goes to a person whatever rounds are left. 90 minutes: a round is
 * ~40 minutes of review plus opencode, so this is two rounds. A loop that is still
 * churning after this is not going to converge on its own.
 */
export const BUILDER_PR_AUTOMATION_TIMEBOX_MS = 90 * 60_000;
/** How long after a release lands before its health is checked. */
export const BUILDER_RELEASE_SETTLE_MS = 5 * 60_000;
export const BUILDER_HEALTH_RETRY_MS = 30_000;
/** How long a failed post-release health check holds automatic merges and releases. */
export const BUILDER_UNHEALTHY_HOLD_MS = 24 * 60 * 60_000;
/** How many recent opencode PRs the track record reads. */
export const BUILDER_TRACK_RECORD_WINDOW = 10;

/**
 * How long a dispatched release may run before it is called failed.
 *
 * Matches Bug Hunter's 90 minutes, for the same reason: an ally-be release runs
 * tests, builds an image, migrates and then waits on ECS to reach steady state,
 * and the slowest of those is the deploy. Long enough that a healthy release
 * never trips it, short enough that "merged but not deployed" surfaces the same
 * working day.
 */
export const BUILDER_RELEASE_TIMEOUT_MS = 90 * 60 * 1000;
export const BUILDER_WORKFLOW_REPO = 'ally-be';
export const BUILDER_WORKFLOW_REF = 'master';

/**
 * How long a dispatch may go uncorrelated before we call it lost.
 * `workflow_dispatch` answers 204 with no run id, so a run that GitHub never
 * registered is indistinguishable from one it registered slowly — until this
 * elapses.
 */
export const BUILDER_DISPATCH_TIMEOUT_MS = 30 * 60_000;

/**
 * Hard ceiling on a run, deliberately past the workflow's own
 * `timeout-minutes: 120` so the runner gets to fail on its own terms first
 * and report why. Only when even that produces nothing do we time it out.
 */
export const BUILDER_RUN_TIMEOUT_MS = 150 * 60_000;

/** Event payloads are truncated here — stream-json is chatty. */
export const BUILDER_EVENT_PAYLOAD_MAX_BYTES = 8_192;

/** Most events a single pipeline POST may carry. */
export const BUILDER_EVENT_BATCH_MAX = 100;

/** Page size for the event feed. */
export const BUILDER_EVENT_PAGE_SIZE = 500;

/** Redis prefix for the per-session dispatch lock. */
export const BUILDER_DISPATCH_LOCK_PREFIX = 'builder-dispatch';
export const BUILDER_DISPATCH_LOCK_TTL_SECONDS = 60;

/** Reconcile cadence key in the scheduled-task registry. */
export const BUILDER_RECONCILE_INTERVAL = '5min';
export const BUILDER_RECONCILE_TASK = 'builder-run-reconcile';

/* ── Checks a fix run must not be dispatched for ────────────────────────── */

/**
 * Failing checks that are real, belong in the timeline, and are still not
 * Builder's to fix from inside a code repo.
 *
 * `docs-guard` is the whole of the list today. Its `repo-page-architecture`
 * rule fires whenever a build touches `src/app.module.ts` or a gateway — which
 * every build that adds a module does — and satisfying it needs a `Wiki-PR:`
 * trailer pointing at a pull request in a repo the runner cannot clone. A fix
 * run can repair the in-repo half (`DATA_SCHEMA.md`) and never the other, so
 * left as PENDING it burns all `maxFixRunsPerPr` attempts and leaves the pull
 * request exactly as red as it started.
 *
 * Recording it OBSERVED keeps it visible and out of `countPending`, which is
 * the same treatment a failure somebody else pushed already gets, and for the
 * same reason: it is true, and it is not ours to act on.
 *
 * DELETE THIS ONCE BUILDER OPENS WIKI PRs ITSELF. At that point the check
 * becomes fixable and suppressing it would hide a real failure.
 */
export const BUILDER_UNFIXABLE_CHECKS: readonly string[] = ['docs-guard'];

/**
 * Whether a check name is one of the above.
 *
 * Normalised rather than compared literally because the name reaching us is
 * GitHub's, not ours: the job id (`docs-guard`) is what the checks API
 * reports, the workflow's own `name:` is "Docs guard", and which one a caller
 * sees has changed with GitHub's rendering before. Matching a name that has
 * drifted costs a wasted fix run; matching one case-insensitively costs
 * nothing.
 */
export const isUnfixableCheck = (check: string): boolean => {
  const normalised = String(check ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  return BUILDER_UNFIXABLE_CHECKS.includes(normalised);
};

/**
 * AI-task-registry row ids for Builder's own calls.
 *
 * Named here rather than spelled inline at the call site: the registry is what
 * resolves a task's tier, and `tierForAiTask` THROWS for an id it does not
 * know, so a typo is a 500 on the first call after deploy rather than a
 * compile error. A constant makes the two halves move together.
 */
export const BUILDER_AI_TASKS = {
  INTERVIEW_SUMMARY: 'builder-interview-summary',
  LESSON_CURATION: 'builder-lesson-curation',
  EPIC_DECOMPOSITION: 'builder-epic-decomposition',
  OUTCOME_CATEGORISE: 'builder-outcome-categorise',
  CONTEXT_SELECTION: 'builder-context-selection',
  PRD_REVIEW: 'builder-prd-review',
  DISCOVERY_PLAN: 'builder-discovery-plan',
  EVAL_ADMIN: 'builder-eval-admin',
  EVAL_JUDGE: 'builder-eval-judge',
  CORRECTION_CLASSIFY: 'builder-correction-classify',
} as const;

// Prompt registry code (src/prompts/builder/interviewer_system.txt).
export const BUILDER_PROMPT_DIR = 'builder';
export const BUILDER_PROMPTS = {
  INTERVIEWER_SYSTEM: 'builder_interviewer_system',
  /**
   * Standing rules every Builder agent gets, ahead of its own instructions.
   * Compiled default: DEFAULT_PLATFORM_RULES in builder-platform-rules.ts.
   */
  PLATFORM_RULES: 'builder_platform_rules',
} as const;

/* ── Notifications ──────────────────────────────────────────────────────── */

/**
 * Which notification kinds are worth interrupting someone for.
 *
 * Everything is recorded in the inbox; only these are announced. The ones left
 * out are good news that keeps — a finished build, a set of pull requests — and
 * announcing those too is how a channel gets muted. A muted channel is worse
 * than no channel: it still looks like coverage.
 *
 * What is in: a spend ceiling has a person waiting on the other side, and a
 * failure ends the work.
 */
export const BUILDER_ANNOUNCED_KINDS: BuilderNotificationKind[] = [
  BuilderNotificationKind.BUILD_FAILED,
  BuilderNotificationKind.BUDGET_REACHED,
  // Merged but not deployed. The strongest case in this list by the rule
  // above: master has moved on, the pull request reads as done, and everyone
  // assumes the change is live — so nobody goes back to look. Auto-release was
  // built on the promise that this shouts, and without it here the watcher
  // would only have written a row nobody opens.
  BuilderNotificationKind.RELEASE_FAILED,
  // Merged and deliberately not released, because the change could not be
  // attributed to exactly one deployable. Quieter, and still not good news
  // that keeps: it sits on master until a person ships it by hand. Low volume
  // by construction — at most one per merged pull request, and only for the
  // ones Builder refuses to guess about.
  BuilderNotificationKind.RELEASE_SKIPPED,
  // The exception that proves the rule above. "A pull request opened" is good
  // news that keeps and stays out; "this one is green, reviewed, approved and
  // waiting on your click" is not news at all — it is the work itself, with the
  // control attached. A message someone acts on is not what mutes a channel.
  BuilderNotificationKind.PR_READY_TO_MERGE,
  BuilderNotificationKind.AUTOMATION_PAUSED,
];

/**
 * Consecutive failed runs before a session stops dispatching automatic ones.
 *
 * The per-PR ceilings — two reviews, three fixes — bound each loop separately,
 * and on 2026-09-16 that still let one session burn eight runs: a review that
 * 500'd on a database error, a fix run sent at feedback that was Builder's own
 * approval, another review, another fix. Every one of those ceilings was
 * respected. None of them noticed that nothing had succeeded since the build.
 *
 * Two, not three: by the second consecutive failure the loop has already
 * demonstrated it is not converging, and the third attempt is the one that
 * reads as not caring. A human retry is not blocked by this — a person looking
 * at the failures and choosing to try again is exactly the judgement the
 * breaker exists to wait for.
 */
export const BUILDER_CONSECUTIVE_FAILURE_LIMIT = 2;

/**
 * Consecutive unauthorised GitHub calls before Builder says so out loud.
 *
 * Not one. A fine-grained token can legitimately be refused a single repository
 * — an allowlist miss, or a grant still pending org approval — and crying
 * credential over that would train people to ignore the message. A run of five
 * across different endpoints is the token itself, which is a different problem
 * and the one that makes every loop above it silently useless.
 */
export const BUILDER_AUTH_FAILURE_ALERT_THRESHOLD = 5;

/* ── Lane A evidence lookups ─────────────────────────────────────────────── */

/**
 * Deadline on one evidence lookup.
 *
 * Well under what the sources allow themselves — the analytics agent alone
 * budgets 120s per ally-ai call and makes two. The admin is watching a cursor,
 * and a slow answer is worse than an honest "that took too long".
 */
export const BUILDER_EVIDENCE_TIMEOUT_MS = 25_000;

/** How far back production errors are read. */
export const BUILDER_EVIDENCE_ERROR_WINDOW_HOURS = 24;

/**
 * Most error shapes returned. Small on purpose: the long tail of one-off
 * errors is noise for a PRD, and the context it would occupy is the context
 * the next question is written in.
 */
export const BUILDER_EVIDENCE_MAX_SHAPES = 12;

/**
 * The only coding engine. Still written to build_runs.engine as a historical
 * record of which CLI ran.
 */
export const BUILDER_ENGINE = 'opencode';

/* ── Model tiering ──────────────────────────────────────────────────────── */

/**
 * The single source of model defaults, per role in the tiered loop. Env vars
 * (`BUILDER_INTERVIEW_MODEL`, `BUILDER_PLANNER_MODEL`, `BUILDER_CODER_MODEL`,
 * `BUILDER_VERIFIER_MODEL`) override via config; builder_settings overrides
 * per environment; StartBuildDto overrides per run. Nothing else may carry a
 * hard-coded model id — the interview/build default drift this replaces came
 * from four separate literals.
 *
 * Tiering rationale: planning and adversarial verification are where model
 * strength changes the outcome; bulk coding follows a plan; mechanical passes
 * (repo maps, summaries, consolidation) need speed and price, not depth.
 *
 * Gemini on every tier, and for the same reason LLM_TIER_FLOOR is OpenAI: a
 * default's job is to be the thing that still works. These used to be Anthropic
 * ids while the build phase already ran on Gemini, which quietly split Builder
 * in half — the interview, the epic decomposition and every mechanical pass ran
 * on Claude because only one of the two code paths consulted the settings row.
 *
 * `gemini-2.5-pro` rather than a per-tier spread because Gemini publishes two
 * general models, not five: pro where the answer's quality is the point, flash
 * where throughput is. Mapping "Opus vs Sonnet" onto that would be inventing a
 * distinction the vendor does not offer.
 */
export const BUILDER_MODEL_DEFAULTS = {
  interview: 'gemini-2.5-pro',
  planner: 'gemini-2.5-pro',
  coder: 'gemini-2.5-pro',
  verifier: 'gemini-2.5-pro',
  mechanical: 'gemini-2.5-flash',
} as const;

/**
 * How big a build is, recorded with each run (and read by the metrics).
 *
 * Sized from the PRD rather than guessed at, because the PRD is the only
 * statement of scope that exists before the work starts.
 */
export enum BuilderBuildSize {
  SMALL = 'small',
  MEDIUM = 'medium',
  LARGE = 'large',
}

/**
 * What a run of each size is recorded with.
 *
 * Builds used to run on Builder's own runner with a planner tier, a coder
 * escalation ladder, turn caps and phase budgets per size. A build is now an
 * issue in its repo, worked by opencode on that repo's own model, so all that
 * is left is the effort label recorded with the run beside its size.
 */
export const BUILDER_SIZE_PROFILES: Record<
  BuilderBuildSize,
  { effort: 'low' | 'medium' | 'high' }
> = {
  [BuilderBuildSize.SMALL]: { effort: 'low' },
  [BuilderBuildSize.MEDIUM]: { effort: 'medium' },
  [BuilderBuildSize.LARGE]: { effort: 'high' },
};

/**
 * How much technical plan a PRD actually carries.
 *
 * `technicalPlan` is an object ({repos:[{repo,changesMd}], dataModelMd, apiMd}),
 * so stringifying it gives "[object Object]" — 15 characters no matter how
 * detailed the plan is, which would have made every PRD look small.
 */
export function prdTechnicalPlanLength(draft: Record<string, any>): number {
  const plan = draft?.technicalPlan;
  if (!plan) return 0;
  if (typeof plan === 'string') return plan.length;

  const repoPlans = Array.isArray(plan.repos) ? plan.repos : [];
  return (
    repoPlans.reduce(
      (total: number, entry: any) =>
        total + String(entry?.changesMd ?? '').length,
      0,
    ) +
    String(plan.dataModelMd ?? '').length +
    String(plan.apiMd ?? '').length
  );
}

/**
 * Classify a PRD.
 *
 * Requirements times repos, because cross-repo work is where planning earns its
 * keep: a contract that spans ally-be and ally-web is the case a coder gets
 * wrong without a plan. Epic mode is always large — it was decomposed precisely
 * because it was too big to hold at once.
 */
export function classifyBuildSize(input: {
  requirementCount: number;
  repoCount: number;
  technicalPlanLength: number;
  isEpic?: boolean;
}): BuilderBuildSize {
  if (input.isEpic) return BuilderBuildSize.LARGE;

  const spread =
    Math.max(1, input.requirementCount) * Math.max(1, input.repoCount);
  if (spread >= 24 || input.technicalPlanLength >= 6000) {
    return BuilderBuildSize.LARGE;
  }
  if (
    (input.requirementCount <= 4 && input.repoCount <= 1) ||
    (spread <= 8 && input.technicalPlanLength < 2000)
  ) {
    return BuilderBuildSize.SMALL;
  }
  return BuilderBuildSize.MEDIUM;
}

/**
 * The platform product map (`BuilderProductMapService`): what Ally is as built, in the cached
 * system prefix of the opportunity copilot and the Builder interview. Sized so the whole map stays around 10k tokens — paid in full once per
 * refresh and at the cached rate on every pass after that.
 */
export const BUILDER_PRODUCT_MAP = {
  /**
   * How long one render is reused. The sources change on the order of a day (knowledge packs
   * are regenerated by a scheduled workflow; docs change with merges), and a stable text is
   * what lets it sit in the prompt cache across an interview's turns.
   */
  TTL_MS: 30 * 60_000,
  /** Reuse of a render in which a source could not be read — short, so a blip heals. */
  RETRY_TTL_MS: 2 * 60_000,
  /**
   * Per repo. A pack opens with what the repo is and its module inventory, which is what a
   * product conversation uses; its conventions and commands come after and are cut.
   */
  PACK_MAX_CHARS: 6_000,
  /** Below this a pack is a failed generation, not a map (prod held a 54-char one). */
  MIN_USABLE_PACK_CHARS: 500,
  WIKI_INDEX_MAX_CHARS: 8_000,
  /** Doc paths listed per repo; the rest are reachable through docs_search. */
  DOCS_PER_REPO: 40,
} as const;
