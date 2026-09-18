/** Poll interval when the last poll found no new events — keeps an idle stream cheap. */
export const BUG_HUNT_SSE_POLL_INTERVAL_MS = 3000;

/** Poll interval right after new events landed — feels closer to live without polling constantly. */
export const BUG_HUNT_SSE_PING_INTERVAL_MS = 1000;

/** Hard cap on auto-merges per repo per run — the rate-limit guardrail from the design plan. */
export const BUG_HUNT_MAX_AUTO_MERGES_PER_RUN = 3;

/** Escalate rather than keep iterating after this many failed fix attempts on one bug. */
export const BUG_HUNT_MAX_FIX_ATTEMPTS = 2;

/**
 * How long the fix agent's escalation-wait loop polls for an admin's answer
 * before giving up for now (see BugFindingService.getAnswerIfReady and the
 * "blocking/synchronous" design in bug-hunt.mjs). A genuinely unbounded wait
 * isn't viable inside one workflow invocation, so this is the deliberate
 * compromise: long enough to catch an admin who's around, short enough that a
 * run doesn't hang for hours. An answer given after the timeout is still
 * picked up — unanswered, the finding just stays NEEDS_INPUT for the next run.
 */
export const BUG_HUNT_ESCALATION_ANSWER_TIMEOUT_MS = 20 * 60 * 1000;

/** How often the fix agent re-checks for an answer during the wait above. */
export const BUG_HUNT_ESCALATION_POLL_INTERVAL_MS = 60 * 1000;

/**
 * How long a question may go unanswered before the digest mentions it.
 *
 * Four hours, not twenty minutes: the point is to catch neglect, not
 * impatience. An admin who has not looked at the tab for an afternoon has not
 * neglected anything, and a digest that fires the moment a sweep asks
 * something would just duplicate the per-finding notification that already
 * went out at that moment.
 */
export const BUG_HUNT_STALE_ESCALATION_AFTER_MS = 4 * 60 * 60 * 1000;

/**
 * Minimum gap between two stale-question digests. The task runs hourly so it
 * notices promptly, but speaks at most once a day — repeating it hourly is what
 * turns an inbox into wallpaper, which is the same reasoning that keeps the
 * inbox collapsed by default.
 */
export const BUG_HUNT_STALE_ESCALATION_QUIET_MS = 24 * 60 * 60 * 1000;

/**
 * How long a declined bug stays "already answered".
 *
 * Dedup used to match open rows only, so a finding the verifier refuted or an
 * admin rejected came back as a brand-new row the next time a sweep noticed
 * the same code — the reviewer re-read and re-rejected the same non-bug
 * nightly, and the queue's oldest items were the ones already dealt with.
 * Matching declined rows too closes that loop, but it must not close it
 * forever: a `wont_fix` is a priority call that can legitimately be revisited,
 * and code changes underneath a `not_a_bug`. Thirty days is roughly "this
 * month's decision still stands".
 */
export const BUG_FINDING_DECLINE_SUPPRESSION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long after a fix ships that the same bug reappearing counts as a
 * REGRESSION rather than a new discovery.
 *
 * Seen live: a shutdown race in ally-ai-learn was fixed and released on 28
 * August, kept happening in production, and the 2 September sweep filed it
 * again as an ordinary new high-severity finding. Nothing connected the two,
 * so the one fact that mattered — *the fix we shipped did not work* — was the
 * one thing the queue did not say. Thirty days is long enough to catch a
 * regression a weekly release cycle would surface and short enough that a bug
 * genuinely reintroduced a quarter later reads as new, which it is.
 */
export const BUG_FINDING_REGRESSION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How many recent declines the sweep prompt carries as "known non-bugs".
 *
 * A cap, not a target, and for the same reason `UX_SIGNAL_CONTEXT_LIMITS` has
 * one: this text is prepended to a protocol the agent has to actually follow,
 * and a hundred rejected titles would crowd out the instructions. Only
 * finder-error declines are eligible (see BUG_FINDING_FINDER_ERROR_REASONS),
 * which is what keeps the list short enough for this cap to rarely bite.
 */
export const BUG_HUNT_KNOWN_NON_BUGS_LIMIT = 40;

/** Chars of each declined title/reason kept in that block — enough to recognise a bug, not to re-read it. */
export const BUG_HUNT_KNOWN_NON_BUG_EXCERPT = 160;

/**
 * Below this, a verified finding waits for a human even in AI mode.
 *
 * Verification now returns a self-assessed 0-1 certainty per verifier (see
 * `buildSweepPrompt` Phase 2), which is only worth collecting if something
 * acts on it. Stacks' "Escalate Low-Certainty Cases Using Confidence Scores"
 * suggests 0.7 as the routing default and that is what this is — a starting
 * point to calibrate against the accept-rate-by-confidence cut in
 * `BugHunterMetricsService`, not a tuned number. Deliberately a plain
 * constant: runtime configuration is worth building when someone needs to
 * tune it without a deploy, and nobody does yet.
 */
export const BUG_HUNT_LOW_CONFIDENCE_THRESHOLD = 0.7;

/** Default window for the metrics endpoint. A month covers enough sweeps for a rate to mean something. */
export const BUG_HUNTER_METRICS_DEFAULT_DAYS = 30;

/** Cap on the metrics window — a year of findings is a report, not a dashboard query. */
export const BUG_HUNTER_METRICS_MAX_DAYS = 365;

/**
 * Cap on the free-text note beside a decline reason.
 *
 * Far shorter than the description cap, and for the opposite reason: a
 * description is the fix agent's whole brief and benefits from detail, whereas
 * this is a margin note on a closed decision. It also rides into the sweep
 * prompt's known-non-bugs block, where length costs the protocol that follows.
 */
export const BUG_FINDING_DECISION_NOTE_MAX_LENGTH = 500;

/** Prompt codes under src/prompts/bug_hunter/ — see toPromptCode('bug_hunter', <stem>). */
export const BUG_HUNTER_PROMPT_CODES = {
  CLASSIFY_REPO: 'bug_hunter_classify_repo',
} as const;

/** Max tokens for the repo-classification call — a one-sentence-rationale JSON reply. */
export const BUG_HUNTER_CLASSIFY_REPO_MAX_TOKENS = 300;

/**
 * Subagent name for Bug Hunter's model escalation path — defined once per
 * fixable repo at `.claude/agents/bug-escalation.md`, pinned to a stronger
 * (and pricier) model than the sweep/fix session's own default. Sweeps and
 * fix sessions run on a cheaper model by default and invoke this subagent by
 * name, via the Task tool, only for the specific finding that warrants it —
 * a genuinely hard root cause, a guarded-path change, or a retry after a
 * non-obvious failure. Control returns to the cheaper default the moment the
 * subagent reports back, so there is nothing to "switch back": escalation is
 * scoped to one finding, not a session-wide mode.
 */
export const BUG_HUNT_ESCALATION_SUBAGENT = 'bug-escalation';

/**
 * Subagent that independently tries to refute one finding — defined once per
 * repo at `.claude/agents/bug-verifier.md`.
 *
 * Separate from `BUG_HUNT_ESCALATION_SUBAGENT` because the two exist for
 * opposite reasons. Escalation buys a STRONGER model for a hard fix.
 * Verification buys INDEPENDENCE: a reader that never saw the finder's
 * reasoning, cannot write code, and starts from the repo. Its value is what it
 * has not been told, so it deliberately runs on the sweep's own cheap model
 * and carries read-only tools.
 *
 * The interactive `bug-hunt.mjs` workflow always did this, with three parallel
 * `agent()` calls. The CI sweep prompt that replaced it collapsed them into
 * "try three times to refute it yourself", which is the same agent grading its
 * own homework — this restores the property that was lost.
 */
export const BUG_HUNT_VERIFIER_SUBAGENT = 'bug-verifier';

/**
 * Shared instruction for when to reach for `BUG_HUNT_ESCALATION_SUBAGENT`,
 * used verbatim by both the sweep and fix-session prompts so the criteria
 * for escalating can't drift between the two protocols.
 */
export const BUG_HUNT_ESCALATION_GUIDANCE =
  `If this finding needs deeper reasoning than a routine fix — a root cause spanning ` +
  `multiple files or modules, a change that sits in a guarded area (auth/permissions, ` +
  `payments, migrations), or an attempt that already failed for a non-obvious reason — ` +
  `hand the fix work to a stronger model instead of pushing through it yourself: invoke ` +
  `the Task tool with subagent_type "${BUG_HUNT_ESCALATION_SUBAGENT}", and give it the ` +
  `finding's full context (description, evidence, file, and — on a retry — what you already ` +
  `tried and why it failed). Take its result as your own work: do not redo the verification ` +
  `it already did, and continue the rest of the protocol yourself. Reserve this for findings ` +
  `that actually warrant it — judge by the bug's difficulty, not by how many attempts you have ` +
  `left; a routine fix does not need it.`;

/**
 * Cap on an admin-rewritten bug description.
 *
 * Generous, because the whole point of the edit is to say more than the
 * original did — a paragraph of context that spares the fix agent a wrong
 * guess is cheap next to a wasted session. The cap exists at all because this
 * text goes verbatim into the fix prompt (see `buildFixSessionPrompt`), where
 * a pasted log dump would crowd out the protocol that follows it. Evidence is
 * the field for raw output.
 */
export const BUG_FINDING_DESCRIPTION_MAX_LENGTH = 5000;
