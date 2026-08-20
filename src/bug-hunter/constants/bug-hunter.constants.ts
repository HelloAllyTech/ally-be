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
