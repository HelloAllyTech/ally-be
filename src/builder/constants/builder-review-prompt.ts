import { BuilderPrdDocument } from '../type/builder-prd.type';
import { BuilderRepoDefinition } from './builder-repos.constants';
import { buildPromptHeader, renderPrd } from './builder-build-prompt';

/**
 * The review pass: read an open pull request Builder raised, and say what is
 * wrong with it — without touching a line of it.
 *
 * ## Why this is a separate run
 *
 * Builder already reviews itself during VERIFY, before the pull request exists.
 * That catches a lot, and it is not the same thing: VERIFY reads work the same
 * session just wrote, with the plan still in context and every reason to
 * believe it. This reads the finished diff cold, the way the first human to
 * open the PR does.
 *
 * It is also separate from FIX on purpose, and the separation is the whole
 * design. A reviewer that can edit the code stops arguing with it and simply
 * rewrites it — and then nothing independent has looked at the result. So this
 * run has no write access to the branch by convention, reports findings, and
 * the existing fix loop acts on them. Two agents, one opinion each.
 *
 * ## Calibration is the hard part
 *
 * The obvious failure is a reviewer that finds nothing. The likelier and more
 * expensive one is a reviewer that always finds something: every finding
 * becomes a PENDING feedback row, every row earns a fix run, and a fix run
 * pushes a commit to a pull request a human may be reading. A reviewer that
 * manufactures three plausible nits per PR turns an open PR into a treadmill
 * and burns the `maxFixRunsPerPr` ceiling on invented work.
 *
 * So the prompt spends most of its length on what does *not* count, and says
 * plainly and more than once that zero findings is the expected answer on a
 * good pull request. An empty report is the signal an approval is built on —
 * it has to be trustworthy in both directions.
 */

export interface ReviewPromptContext {
  sessionId: string;
  runId: string;
  branchSlug: string;
  prd: BuilderPrdDocument;
  repos: BuilderRepoDefinition[];
  apiBaseUrl: string;
  pullRequest: {
    id: string;
    repo: string;
    branch: string;
    prNumber: number;
    prUrl: string;
    baseRef: string;
  };
  /** Which review this is for the PR, and the ceiling. */
  attempt: number;
  maxAttempts: number;
}

/**
 * The cap on reported findings.
 *
 * Not a target. A diff with more than eight genuine defects has something
 * structurally wrong that a list of line comments will not convey, and the
 * report field is the place to say so.
 */
export const BUILDER_REVIEW_MAX_FINDINGS = 8;

export function buildReviewPrompt(context: ReviewPromptContext): string {
  const { pullRequest } = context;

  const header = `${buildPromptHeader({
    sessionId: context.sessionId,
    runId: context.runId,
    branchSlug: context.branchSlug,
    apiBaseUrl: context.apiBaseUrl,
    repos: context.repos,
    role: 'review agent',
  })}

You are reviewing an **open pull request** that Builder raised:
${pullRequest.repo}#${pullRequest.prNumber} — ${pullRequest.prUrl}
Branch: \`${pullRequest.branch}\` against \`${pullRequest.baseRef}\`

This is review ${context.attempt} of ${context.maxAttempts} for this pull request.

**You do not change code in this run.** No edits, no commits, no pushes, no
\`gh pr merge\`, no closing anything. You read, and you report. A separate fix
run acts on what you find, and it can only do that honestly if the thing that
found the problem is not the same thing that fixed it.`;

  const protocol = `
## Protocol

**1. \`stage SETUP\`** — the branch is checked out under
\`repos/${pullRequest.repo}\`. Get the diff under review:

\`\`\`bash
git -C repos/${pullRequest.repo} fetch origin ${pullRequest.baseRef} --quiet
git -C repos/${pullRequest.repo} diff origin/${pullRequest.baseRef}...HEAD
\`\`\`

That diff is the scope. Code outside it is context you may read, never
something to file a finding about.

**2. \`stage REVIEWING\`** — read every hunk, and open the surrounding files for
context. You are looking for defects that would actually bite:

- wrong or inverted conditions, off-by-one, operator-precedence slips
- null or undefined dereference on a path that can really happen
- a missing \`await\`, an unhandled rejection, a dropped error
- a removed guard, validation or permission check
- callers of a changed function that were not updated
- races, and state that can be observed half-written
- a tenant-unscoped query — on this platform that is a data leak, not a bug
- behaviour that contradicts the PRD below

**Every finding needs a concrete failure scenario**: the input or state, and
what goes wrong as a result. If you cannot write that sentence, you have a
feeling, not a finding, and it does not go in the report.

**3. What is NOT a finding.** This is most of the job.

- Style, formatting, naming, import order — lint and the formatter own these,
  and they already ran.
- "Consider extracting…", "this could be cleaner", "a more idiomatic way" —
  refactoring suggestions about code that works.
- Missing tests for a case that cannot occur, or that an existing test covers
  in a way you did not look for.
- Anything already handled elsewhere in the file. **Read before you claim.** A
  guard three lines up, an early return, a validated DTO — check for these
  before filing, because a confidently wrong finding sends a fix run to change
  working code.
- Anything outside this diff, however tempting. Put it in \`report\` instead.
- Speculation about performance with no measurement behind it.

**4. Zero findings is the expected answer on a good pull request**, and the
correct one on most. Builder wrote this code against a plan, verified it, and
it is passing CI. Do not pad the report to look useful. An empty list is a
result, it is recorded as one, and it is what lets this pull request move
forward — a manufactured finding does not just waste a run, it pushes a commit
into somebody's open review.

Equally: if something is genuinely broken, say so plainly however late it is.

**5. Report your findings.** At most ${BUILDER_REVIEW_MAX_FINDINGS}, most
serious first. Write a JSON file and post it:

\`\`\`json
{
  "pullRequestId": "${pullRequest.id}",
  "findings": [
    {
      "key": "short-stable-slug",
      "path": "src/builder/service/builder-build.service.ts",
      "line": 662,
      "body": "One sentence stating the defect, then the concrete scenario in which it misbehaves."
    }
  ]
}
\`\`\`

\`\`\`bash
review() {
  curl -sS -X POST "${context.apiBaseUrl}/api/v1/builder/pipeline/runs/${context.runId}/review" \\
    -H "x-api-key: $ALLY_BE_API_KEY" \\
    -H 'Content-Type: application/json' -d @"$1" >/dev/null || true
}
\`\`\`

Post the report **even when there are no findings** — \`"findings": []\` is the
clean result, and a review that reports nothing at all is indistinguishable
from one that crashed.

Write \`body\` for the engineer who will read it on the pull request: what is
wrong, and when it breaks. No preamble, no praise, no restating the diff.

**6. \`stage REPORTING\`** — \`report\` with your overall read of the change:
whether it does what the PRD asked, anything out of scope worth knowing, and
your confidence. Then \`complete '{"outcome":"done"}'\` exactly once.

## If you cannot review it

\`ask\` if the diff is unreadable for a reason a person needs to resolve — the
branch is not what the PR says it is, or the change depends on something you
cannot see. Do not file findings to have something to say.

## The PRD this was built from
`.trim();

  return [header, protocol, renderPrd(context.prd)]
    .filter(Boolean)
    .join('\n\n---\n\n');
}
