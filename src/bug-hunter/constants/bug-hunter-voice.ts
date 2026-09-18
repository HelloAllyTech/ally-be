/**
 * Everything Bug Hunter says to an admin, in its own words.
 *
 * The admin console presents Bug Hunter as a colleague — a software test
 * engineer whose work you check in on — and its inbox is the only channel it
 * speaks on. These strings are the ones the console cannot write for itself:
 * they are composed here, at the moment the thing actually happens, and stored
 * on the notification row.
 *
 * They are first person for that reason. A message *from* Bug Hunter that says
 * "Bug Hunter is stuck on ally-be" is someone else narrating it, and the whole
 * point of the inbox is that there is somebody there to answer.
 *
 * The voice rules this follows are documented once, in ally-web's
 * `apps/ally-admin-dashboard/src/pages/BugHunter/agentPersona.ts`, alongside the
 * console-side strings: first person, plain and calm, never claiming work it
 * hasn't done, and always ending with what happens next. Change them there.
 *
 * Keeping the copy in one module rather than inline at each `notify()` call
 * means the voice can be read — and reviewed — in one sitting, instead of
 * being reconstructed from eight template literals across three services.
 */

export interface BugHunterMessage {
  title: string;
  body?: string;
}

/**
 * Entity columns come back as `string | null | undefined` — nullable in the
 * database, and optional on the TypeORM entity. Every parameter here is typed
 * to accept exactly what a caller already holds, so the voice module never
 * pushes a non-null assertion back into a service.
 */
type Maybe<T> = T | null | undefined;

/** "ally-be → ally-web → ally-ai", the order the repos have to ship in. */
const chain = (repos: Maybe<string>[]): string =>
  repos.map((repo) => repo ?? 'an unassigned repo').join(' → ');

/** Human step number: stepIndex is zero-based, nobody says "step 0". */
const stepNumber = (stepIndex: Maybe<number>): number => (stepIndex ?? 0) + 1;

/**
 * It has asked a question about one bug and cannot continue until it is
 * answered. The question itself is already in its own words, so it is passed
 * through as the body rather than being described.
 */
export const needsYourAnswer = (
  findingTitle: string,
  question: Maybe<string>,
): BugHunterMessage => ({
  title: `I need your answer: ${findingTitle}`,
  body: question ?? undefined,
});

/**
 * Constant title, because the stale-question digest is deduplicated by matching
 * on it: raising one is conditional on no digest having gone out in the last
 * day, and there is no metadata column on the notifications table to mark them
 * with. Changing this string starts a fresh dedup window — harmless, but worth
 * knowing.
 */
export const STALE_ESCALATION_DIGEST_TITLE =
  "I'm still waiting on answers before I can carry on";

/**
 * One or more questions have gone unanswered long enough that nothing is moving
 * on those bugs.
 *
 * This exists because the inbox is pull-only by design — no email, no push,
 * Slack deliberately removed — so a question asked at 2am during an unattended
 * sweep would otherwise sit unread indefinitely, with the finding stuck at
 * NEEDS_INPUT and no one aware. A sweep does not wait for an answer (only an
 * on-demand fix session does, since an admin just pressed the button and is
 * probably still there), which is exactly why the unanswered ones need
 * something to resurface them.
 *
 * Deliberately ONE message covering all of them rather than one per finding:
 * the reader's problem is "what is blocked on me", not "here are nine rows",
 * and nine action_needed notifications would bury the badge they are meant to
 * light up.
 */
export const stillWaitingOnAnswers = (
  findingTitles: string[],
  oldestDays: number,
): BugHunterMessage => {
  const count = findingTitles.length;
  const age =
    oldestDays >= 1
      ? `The oldest has been waiting ${oldestDays} ${oldestDays === 1 ? 'day' : 'days'}.`
      : 'The oldest has been waiting since earlier today.';
  return {
    title: STALE_ESCALATION_DIGEST_TITLE,
    body: [
      count === 1
        ? 'There is one bug I stopped on because I need a decision from you:'
        : `There are ${count} bugs I stopped on because I need a decision from you:`,
      ...findingTitles.map((title) => `• ${title}`),
      age,
      'Open any of them to read the question and answer it. I will pick the answer up on my next run.',
    ].join('\n'),
  };
};

/** A hunt run escalated: it has stopped mid-sweep and wants a human. */
export const stuckOnRepo = (
  repo: string,
  summary: string,
): BugHunterMessage => ({
  title: `I'm stuck on ${repo}`,
  body: summary,
});

interface RunTotals {
  foundCount: number;
  autoMergedCount: number;
  prOpenedCount: number;
  dismissedCount: number;
}

/** What a finished sweep amounted to — the same four numbers the shift log shows. */
const runSummaryBody = (totals: RunTotals, costUsd: string): string =>
  `I merged ${totals.autoMergedCount} myself · ${totals.prOpenedCount} waiting on your review · ${totals.dismissedCount} dismissed · est. cost $${costUsd}`;

export const runFailed = (
  repo: string,
  totals: RunTotals,
  costUsd: string,
): BugHunterMessage => ({
  title: `My run on ${repo} failed`,
  body: runSummaryBody(totals, costUsd),
});

export const runFoundBugs = (
  repo: string,
  totals: RunTotals,
  costUsd: string,
): BugHunterMessage => ({
  title: `I found ${totals.foundCount} bug${
    totals.foundCount === 1 ? '' : 's'
  } in ${repo}`,
  body: runSummaryBody(totals, costUsd),
});

/** A fix that turns out to need more than one repo, and the plan for it. */
export const planCreated = (
  findingTitle: string,
  repos: Maybe<string>[],
): BugHunterMessage => ({
  title: `I'll fix "${findingTitle}" across ${repos.length} repos`,
  body: `I'll work through ${chain(repos)} in that order, then release them in the same order once you approve.`,
});

/** Every step of a plan is merged; only the deploy is left, and that is a human call. */
export const planReadyToRelease = (
  findingTitle: string,
  repos: Maybe<string>[],
): BugHunterMessage => ({
  title: `I've merged everything — ready to release: ${findingTitle}`,
  body: `All ${repos.length} of my steps are merged (${chain(repos)}). Releasing deploys them to production in that order — open the bug and approve, and I'll start.`,
});

/** A step of a plan has stopped on a question. The rest of the plan waits. */
export const planStepNeedsAnswer = (
  findingTitle: string,
  stepIndex: Maybe<number>,
  repo: Maybe<string>,
  question: Maybe<string>,
): BugHunterMessage => ({
  title: `I'm stuck on step ${stepNumber(stepIndex)} (${repo}): ${findingTitle}`,
  body:
    question ??
    "I can't carry on with this step until I have an answer from you.",
});

/** A step of a plan failed outright, which stops the whole plan where it is. */
export const planStepFailed = (
  findingTitle: string,
  stepIndex: Maybe<number>,
  repo: Maybe<string>,
): BugHunterMessage => ({
  title: `My step ${stepNumber(stepIndex)} (${repo}) failed: ${findingTitle}`,
  body: "I've put the remaining steps on hold — they depend on this one. Nothing from this plan has been released.",
});

/** A sequenced release went red partway through, leaving the plan half-deployed. */
export const planReleaseStopped = (
  findingTitle: string,
  stepIndex: Maybe<number>,
  repo: Maybe<string>,
): BugHunterMessage => ({
  title: `I stopped the release at step ${stepNumber(
    stepIndex,
  )} (${repo}): ${findingTitle}`,
  body: `The steps before it are live; the rest are on hold. Every step is merged to master either way — ask me to retry once ${repo}'s pipeline is green.`,
});

/** Every step of a plan is deployed. */
export const planReleased = (
  findingTitle: string,
  steps: { repo?: Maybe<string>; releaseTag?: Maybe<string> }[],
): BugHunterMessage => ({
  title: `It's live in production: ${findingTitle}`,
  body: `I released all ${steps.length} steps in order — ${steps
    .map((step) => `${step.repo} ${step.releaseTag ?? ''}`.trim())
    .join(', ')}.`,
});

/** One ordinary bug's fix is deployed. */
export const findingReleased = (
  findingTitle: string,
  releaseTag: Maybe<string>,
  repo: Maybe<string>,
): BugHunterMessage => ({
  title: `It's live in production: ${findingTitle}`,
  body: `I released it as ${releaseTag} in ${repo}.`,
});

/**
 * A bug it already fixed and shipped is happening again.
 *
 * This earns ACTION_NEEDED rather than PROBLEM, which is a departure from the
 * level rule that reserves it for "I am blocked and cannot continue". Nothing
 * is technically blocked here — Bug Hunter has filed the new finding and could
 * be told to fix it again. But a fix that did not hold is the one outcome
 * where doing the same thing again is probably wrong, and the useful next move
 * is a person deciding whether the root cause was ever understood. Filed
 * quietly, it reads as an ordinary new bug, which is exactly how the
 * ally-ai-learn shutdown race went round twice.
 *
 * It states the days deliberately: "I fixed this eleven days ago" is the fact
 * that makes a reader stop, and it is not recoverable from the row.
 */
export const fixDidNotHold = (
  findingTitle: string,
  repo: Maybe<string>,
  daysSinceFix: number,
): BugHunterMessage => ({
  title: `My fix didn't hold: ${findingTitle}`,
  body:
    `I fixed this ${daysSinceFix === 0 ? 'earlier today' : `${daysSinceFix} day${daysSinceFix === 1 ? '' : 's'} ago`}` +
    ` in ${repo ?? 'an unassigned repo'} and it is happening again. I have filed it as a new bug linked to the old one. ` +
    `Before I try the same fix twice, it is worth someone checking whether the root cause was the one I found.`,
});

/** The deploy went red. The fix is still on master, which is the part that matters. */
export const findingReleaseFailed = (
  findingTitle: string,
  releaseTag: Maybe<string>,
  repo: Maybe<string>,
  detail: Maybe<string>,
): BugHunterMessage => ({
  title: `My release failed: ${findingTitle}`,
  body: `Release ${releaseTag} of ${repo} went red (${
    detail ?? 'unknown'
  }). The fix is still merged to master, but it is NOT deployed — check the run, then ask me to retry.`,
});
