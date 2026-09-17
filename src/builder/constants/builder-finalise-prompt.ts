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
  /**
   * Tunable conduct guidance from prompt management. Null when the row and the
   * file are both missing, in which case DEFAULT_FINALISE_GUIDANCE is used —
   * never an empty block, which would quietly drop the section.
   */
  guidance?: string | null;
}

/**
 * The compiled-in conduct block.
 *
 * This is the fallback, not the source of truth: `builder_finalise_guidance`
 * is, and it ships as a file with this same text. It exists so a missing row,
 * an unreachable database or a typo in the prompt code degrades to the
 * behaviour we already had rather than to a prompt with a hole in it.
 */
export const DEFAULT_FINALISE_GUIDANCE = `## Conduct

- **No secrets** in code, logs, events or PR bodies.
- A PR body is read by someone who has not seen any of this. Write what they
  need to review it, not a narration of how the run went.`;

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
- a \`Wiki-PR:\` trailer — see "The docs guard" below. Every PR needs one.

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

**5. \`complete-run '{"outcome":"done"}'\`** — exactly once, last.

## The docs guard

Every repo here runs a "Docs guard" check on the pull request. It reads
\`.docs-map.yml\` and fails when a change touches code a doc is declared to
cover and the doc did not move with it. A red guard is a red PR, and nothing
downstream can clear it for you — so deal with it here, before you open one.

**Do not work this out yourself.** The runner has already matched every rule's
globs against your diff, and the answer is in
\`/tmp/builder-docs-map-<repo>.txt\` — one line per fired rule:

\`\`\`
UNSATISFIED  data-schema  requires=DATA_SCHEMA.md  triggered-by=src/x/entity/y.entity.ts
NEEDS_WIKI_PR  repo-page-architecture  requires=wiki:repos/ally-be.md  triggered-by=src/main.ts
\`\`\`

\`no-rules-fired\` means there is nothing to do here — skip to the PR body.
Reading \`.docs-map.yml\` and reasoning about globs yourself is spending turns
on a question already answered, and answered the same way every time.

Act on what each line says:

- The rule requires a file **in this repo** (\`DATA_SCHEMA.md\`,
  \`docs/*.md\`) — the coding phase should already have updated it. If it did
  not, update it now and commit that on the branch. This is the half you can
  actually fix.
- The rule requires a **wiki page** (\`requires: wiki:...\`) — write it, using
  the flow below. The wiki is cloned for you at \`.wiki-tmp\` (repo root, beside
  \`repos/\`, not inside it).

**Every PR body ends with a \`Wiki-PR:\` trailer**, on its own line, last.

### When a wiki rule fired

The ordering matters and is not the obvious one — \`wiki-pr.sh\` needs the code
PR's URL, so the code PR has to exist *before* the trailer can be written:

1. \`gh pr create\` as above, without the trailer. Note the URL it prints.
2. Edit the page under \`.wiki-tmp/wiki/\` — the one the rule names. Write what
   changed, in the voice of the page you are editing; do not append a
   changelog entry to a reference page.
3. Check you may push to the wiki before running anything:
   \`gh api repos/helloallytech/helloallytech.github.io --jq '.permissions.push'\`
   If that is not \`true\`, **stop here** and use the "could not" trailer below.
   Do not proceed — \`wiki-pr.sh\` responds to missing write access by forking
   the repo to whoever this runner's token belongs to, and an agent creating
   repositories in somebody's account unattended is not a thing this run gets
   to decide. A person running the same script can make that call; you cannot.

   If it is \`true\`, then from inside the code repo you changed, run:
   \`../../.wiki-tmp/scripts/wiki-pr.sh "<the PR url from step 1>"\`
   It opens the wiki PR, links it to yours so the two merge together, and
   prints the trailer line to use.
4. \`gh pr edit <url> --body\` — re-send the body with that trailer appended.

The wiki is **public**. No secrets, credentials, internal hostnames, IP
addresses or cloud region details on a page, ever — the same rule the repo's
own CLAUDE.md states, and worth re-reading before you write.

### When it did not, or you could not

\`\`\`
Wiki-PR: none — <one line saying why>
\`\`\`

Either no wiki rule matched this diff, or something stopped you. **Check that
\`.wiki-tmp\` exists before relying on it** — it is absent on a run whose
workflow predates it as well as on a run whose clone failed, and both look the
same from here. \`wiki-pr.sh\` erroring is the third case. Say which, and say
what page still needs writing: "repo-page-architecture fired — repos/ally-be.md
needs the new module listed; wiki clone was not present". A trailer is not a
way of dismissing the requirement; it is how you hand it over.

Never use the \`docs:skip\` label. That is a human's call, not yours.

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

${context.guidance?.trim() || DEFAULT_FINALISE_GUIDANCE}
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
