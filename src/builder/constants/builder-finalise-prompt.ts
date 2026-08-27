import { BuilderPrdDocument } from '../type/builder-prd.type';
import { BuilderRepoDefinition } from './builder-repos.constants';
import { buildPromptHeader, renderPrd } from './builder-build-prompt';

/**
 * The finalise pass: E2E where it proves something, then push, pull requests,
 * report and completion.
 *
 * This exists as its own invocation because opening a pull request is the
 * irreversible step, and it now happens **after** the machine gate and the
 * fresh-context reviewer rather than before them. The old protocol had the
 * agent open PRs at step 11 and the verifier run afterwards, so a failing
 * verdict failed a run whose pull requests were already sitting in the org.
 *
 * A separate invocation also means the agent doing it has a clean context: by
 * the time a two-hour coding pass reaches its end it is the worst-placed
 * reader of its own PR body.
 */

export interface FinalisePromptContext {
  sessionId: string;
  runId: string;
  branchSlug: string;
  prd: BuilderPrdDocument;
  repos: BuilderRepoDefinition[];
  apiBaseUrl: string;
  /** Where a person watches this run — goes in the PR body. */
  sessionUrl: string;
  /** Gate results, so the PR body can carry real evidence. */
  gateSummary?: string | null;
  /** The reviewer's non-blocking notes, worth surfacing to a human. */
  verifierNotes?: string | null;
  planMd?: string | null;
}

export function buildFinalisePrompt(context: FinalisePromptContext): string {
  const header = `${buildPromptHeader({
    sessionId: context.sessionId,
    runId: context.runId,
    branchSlug: context.branchSlug,
    apiBaseUrl: context.apiBaseUrl,
    repos: context.repos,
    role: 'finalising agent',
  })}

The change for the PRD below is already written and committed on the branches
in \`repos/\`. It has passed the machine test gate and an independent
fresh-context review. Your job is to prove it end to end where that is worth
doing, then ship it as pull requests for a human to review.

You are the last phase. Nothing runs after you.`;

  const protocol = `
## Protocol

**1. \`stage E2E_VERIFY\`** — see "End-to-end" below. Do this before pushing:
if it finds something broken, fix it here and re-run the affected suites.

**2. Push.** Push each branch. Squash nothing, force-push nothing.

**3. \`stage OPENING_PRS\`** — one PR per touched repo with \`gh pr create\`.
The body must carry:

- what changed and why, drawn from the PRD summary;
- the requirement ids covered;
- the test evidence: the commands the gate ran and their results;
- the reviewer's remaining non-blocking notes, if any, so a human sees what
  was raised and consciously accepted;
- any deviation from the PRD, with your reasoning;
- a link to ${context.sessionUrl};
- the line **"Opened by Builder — human review and merge required."**

Then record them with \`prs\`.

Never run \`gh pr merge\`. Never push to master. If a push is rejected because
the branch moved under you, stop and \`ask\` — a human pushed to your branch and
that is not yours to resolve.

**4. \`stage REPORTING\`** — write the account of the run with \`report\`: what
was built, files changed per repo, tests added and their results, decisions
made that the PRD did not dictate, anything left undone.

Include in the metrics:
- \`retrospective\`: 3-5 short lessons a future Builder run should know —
  traps hit, conventions that had to be discovered, estimates that were wrong.
  These feed forward into later builds, so write them for a stranger: "X in
  repo Y silently does Z" beats "be careful with X".
- \`appliedLessonIds\`: the ids (\`L-xxxx\`) of any lessons from previous runs
  that actually changed what this run did. An unused lesson is one nobody
  should keep paying context for.

**5. \`complete '{"outcome":"done"}'\`** — exactly once, last.

## End-to-end

Worth doing only when it can prove something the unit tests cannot. Bring up
what you need (\`docker compose up -d postgres redis localstack\` in ally-be,
migrations, the service, the frontend), exercise the feature the way a person
would, and capture evidence with \`note e2e_evidence "…"\`.

Skip it — with \`note e2e_skipped "<reason>"\` — when any of these hold:

- the change is backend logic that unit tests already cover properly;
- stack bring-up has failed twice;
- fewer than 25 minutes of the runner's budget remain.

Skipping with a stated reason is a fine outcome. Failing the build because a
docker-compose service was slow is not.

## Conduct

- **No secrets** in code, logs, events or PR bodies.
- A PR body is read by someone who has not seen any of this. Write what they
  need to review it, not a narration of how the run went.
`.trim();

  const evidenceBlock = [
    context.gateSummary ? `## Gate results\n\n${context.gateSummary}` : '',
    context.verifierNotes
      ? `## Reviewer notes (non-blocking, carry these into the PR body)\n\n${context.verifierNotes}`
      : '',
    context.planMd ? `## The plan this run followed\n\n${context.planMd}` : '',
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');

  return [header, protocol, evidenceBlock, renderPrd(context.prd)]
    .filter(Boolean)
    .join('\n\n---\n\n');
}
