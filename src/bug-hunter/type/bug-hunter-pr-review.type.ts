/**
 * The PR review sense — OPP-0785.
 *
 * A pull request a person opened on one of the five repos is reviewed while
 * it is open: a `pr_review` run checks out its head, runs the diff-review
 * sense and the Verifier's checklist, and files findings linked to the PR.
 * The independent Verifier judges them like any other finding, and a
 * confirmed one lands on the PR as a review comment with its evidence.
 * Never a blocking check: precision has to earn that first, and the
 * scoreboard counts it per repo under the `pr_review` sense.
 */

/** Which pull request a review run, or a finding, is about. Stored on `bug_hunt_runs.metadata.prReview` and `bug_findings.metadata.pr`. */
export interface PrReviewTarget {
  number: number;
  url: string;
  headSha: string;
  baseRef: string;
  author: string;
  title: string;
  body: string | null;
}

/** The link a finding carries to the PR it was found on; `commentUrl` once Bug Hunter has spoken on the PR. */
export interface BugFindingPrRef {
  number: number;
  url: string;
  headSha: string;
  commentUrl?: string | null;
  commentedAt?: string | null;
}

/** GitHub logins whose pull requests are never reviewed: Bug Hunter's own, Builder's, and dependency bots. */
export const BUG_HUNT_PR_REVIEW_SKIP_AUTHORS: readonly string[] = [
  'ally-bug-hunter[bot]',
  'adminbughunterhelloallyai',
  'dependabot[bot]',
  'github-actions[bot]',
];

/** Only pull requests touched this recently are picked up, so the first deploy does not review every stale PR in five repos. */
export const BUG_HUNT_PR_REVIEW_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** At most this many review runs dispatched per repo per poll, so a busy morning does not start ten runners at once. */
export const BUG_HUNT_PR_REVIEW_MAX_DISPATCH_PER_POLL = 2;

export const BUG_HUNT_PR_REVIEW_TASK = 'bug-hunter-pr-review-poll';
