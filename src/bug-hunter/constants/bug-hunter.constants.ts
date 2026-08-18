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

/** Prompt codes under src/prompts/bug_hunter/ — see toPromptCode('bug_hunter', <stem>). */
export const BUG_HUNTER_PROMPT_CODES = {
  CLASSIFY_REPO: 'bug_hunter_classify_repo',
} as const;

/** Max tokens for the repo-classification call — a one-sentence-rationale JSON reply. */
export const BUG_HUNTER_CLASSIFY_REPO_MAX_TOKENS = 300;
