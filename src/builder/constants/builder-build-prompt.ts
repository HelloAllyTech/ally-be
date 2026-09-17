import { BuilderPrdDocument } from '../type/builder-prd.type';
import { BuilderRepoDefinition } from './builder-repos.constants';

/**
 * The build protocol, rendered per run and fetched by the runner over HTTP.
 *
 * It lives here rather than in the workflow YAML for the same reason Bug
 * Hunter's does: the protocol changes far more often than the plumbing, and a
 * protocol baked into a checked-out workflow file only takes effect after a
 * PR merges into every repo that holds a copy. Fetched at run time, a change
 * applies to the next dispatch.
 *
 * The prefix (everything before the PRD) is deliberately stable across a
 * session's runs so it stays prompt-cacheable on resume.
 */

export interface BuildPromptContext {
  /**
   * Tunable conduct guidance from prompt management. Null when the row and the
   * file are both missing, in which case DEFAULT_CODER_GUIDANCE is used — never
   * an empty block, which would silently drop the section.
   */
  guidance?: string | null;
  sessionId: string;
  runId: string;
  branchSlug: string;
  mode: 'build' | 'resume';
  prd: BuilderPrdDocument;
  repos: BuilderRepoDefinition[];
  apiBaseUrl: string;
  /** Where a person can watch this run, for the PR body. */
  sessionUrl: string;
  lessons: string[];
  /** Digests of similar past builds and how they turned out. */
  exemplars?: string[];
  /** Epic mode — the slice of the PRD this run is responsible for. */
  milestone?: {
    position: number;
    total: number;
    title: string;
    summaryMd?: string | null;
    requirementIds: string[];
    technicalNotesMd?: string | null;
    /** Branch to build on top of, when a previous milestone left one. */
    baseBranch?: string | null;
    /** What earlier milestones already delivered. */
    completed: { position: number; title: string; branch: string }[];
  } | null;
  /** Resume only — the branches the paused run left behind. */
  branches?: Record<string, string> | null;
  /** Resume only — server-condensed state from the previous run. */
  resumeContext?: string | null;
  /** Resume only — the questions just answered. */
  answeredQuestions?: { prompt: string; answer: string }[];
}

/**
 * Shared prelude for every phase prompt: who you are, where the repos are,
 * the reporting helpers, and the repo command table. Rendered identically for
 * plan, code, remediate and finalise so the cached prefix is shared across
 * a run's invocations.
 */
export function buildPromptHeader(context: {
  sessionId: string;
  runId: string;
  branchSlug: string;
  apiBaseUrl: string;
  repos: BuilderRepoDefinition[];
  role: string;
}): string {
  return `
You are Builder's ${context.role}, working inside a GitHub Actions runner on
the Ally platform.

Session: ${context.sessionId}
Run: ${context.runId}
Branch slug: \`builder/${context.branchSlug}\`
Repos are checked out side by side under \`repos/<name>\`.

${buildHelpers(context.apiBaseUrl, context.runId)}

## Never wait for CI

CI runs **after** this run ends, on the commits you pushed. You cannot see its
result and nothing will notify you of it. Do not sleep, poll, re-read the
checks, or "wait for the background task" — there is no background task, and
the runner is being billed for every minute you spend idling.

Push, report, \`complete-run\`. That is the whole contract. If CI goes red on what
you pushed, the reconcile loop dispatches a fresh fix run at it with the
failures in hand; that is a later run's job and it is better equipped for it
than you are, because it can actually read the failure.

**Ending your turn without calling \`complete-run\` is recorded as a run failure**
even when your work pushed cleanly — the runner cannot tell "finished quietly"
apart from "died". A run that fixed the bug, pushed it green, then stopped to
watch CI is filed alongside the ones that crashed, and it counts toward the
circuit breaker that stops automatic work on this session.

## Repos and their commands

${renderRepoCommands(context.repos)}
`.trim();
}

/**
 * The reporting protocol, as documentation for commands that already exist.
 *
 * These used to be shell FUNCTION DEFINITIONS pasted into the prompt, on the
 * reasoning that a pre-built curl beats one the model writes freshly each
 * time. That part was right; embedding them was not. A coding agent's shell
 * tool spawns a fresh shell per call, so a function defined in one call does
 * not exist in the next — the definitions only worked because Claude Code
 * pastes the whole body every time.
 *
 * Gemini read the same block and ran `stage REMEDIATING`, which is exactly
 * what the documentation appears to describe. It got `bash: line 1: stage:
 * command not found`, eight times, silently — every helper ended in `|| true`,
 * because telemetry must never fail a build. That run coded, tested and
 * committed while the progress rail sat frozen and no gate result was ever
 * posted, and the person watching it had no way to tell the difference between
 * a stuck build and a build that had stopped talking.
 *
 * They are now real executables, put on PATH by run-engine.sh. This block
 * describes them. See scripts/builder/agent-helpers/.
 */
const buildHelpers = (apiBaseUrl: string, runId: string): string => {
  void apiBaseUrl;
  void runId;
  return `
### Reporting helpers

These are **commands already installed on your PATH** — run them directly, the
way you would run \`git\` or \`jq\`. Do not define them, source them, or write
your own curl; they carry the run id and the API key for you.

They are how the person watching this build sees what you are doing. A stage
you never report is a stage that looks like it never happened, and a build that
stops reporting is indistinguishable from a build that has hung.

\`\`\`bash
stage RUNNING_TESTS        # Move to a new stage. Call it when you START one.
todo items.json            # Replace the WHOLE todo list, not a delta:
                           #   [{"id":"1","text":"…","status":"pending|in_progress|done"}]
note plan notes.md         # A milestone: plan, test_output, verification, …
                           #   Pass a FILE for anything long or quoted; a short
                           #   unquoted string also works.
ask questions.json         # Pause and ask: {"questions":[…],"branches":{…}}
budget                     # What is left of this session's spend ceiling
prs prs.json               # {"pullRequests":[{repo,branch,prNumber,prUrl,title}]}
report report.json         # {"type":"run_report","contentMd":"…","metrics":{…}}
complete-run done          # Finish. Exactly once, last.
complete-run failed "the gate stayed red after four attempts"
\`\`\`

Run one with no arguments and it prints its usage. \`stage\` and \`complete-run\`
confirm on success, so a silent one did not land.

**Prefer a file over a quoted string** wherever one is accepted. Long text with
apostrophes, backticks or newlines is where shell quoting goes wrong, and some
agent shell tools refuse such a command outright rather than running it —
which has cost a finished run its outcome before now.

\`ask\` and \`complete-run\` are the two that can fail your run, and both say so
loudly rather than returning quietly: a pause that was refused leaves you still
running (ask again with a real question), and an outcome that was not recorded
means the run is filed as one that never reported.

`.trim();
};

export const renderPrd = (prd: BuilderPrdDocument): string => {
  const requirements = (prd.requirements ?? [])
    .map((requirement) => {
      const criteria = Array.isArray(requirement.acceptanceCriteria)
        ? requirement.acceptanceCriteria
        : [];
      const criteriaList = criteria.length
        ? criteria.map((criterion) => `    - ${criterion}`).join('\n')
        : '    - (none stated — treat this as a gap and say so in your report)';
      return `- **${requirement.id} — ${requirement.title}**\n  ${requirement.description}\n  Acceptance criteria:\n${criteriaList}`;
    })
    .join('\n\n');

  const repoPlans = (prd.technicalPlan?.repos ?? [])
    .map((plan) => `#### ${plan.repo}\n\n${plan.changesMd}`)
    .join('\n\n');

  const assumptions = (prd.assumptions ?? [])
    .map((assumption) => `- [${assumption.status}] ${assumption.text}`)
    .join('\n');

  return `
# PRD — ${prd.title}

## Summary
${prd.summary}

## Problem
${prd.problem}

## Users & context
${prd.usersAndContext}

## What already exists
${prd.existingBehaviour || '(not established — treat every claim below as unverified and check before building)'}

## Goals
${prd.goals}

## Non-goals
${prd.nonGoals}

## Requirements
${requirements || '(none)'}

## Assumptions
${assumptions || '(none)'}

## Technical plan
${repoPlans || '(none)'}

${prd.technicalPlan?.dataModelMd ? `### Data model\n${prd.technicalPlan.dataModelMd}\n` : ''}
${prd.technicalPlan?.apiMd ? `### API\n${prd.technicalPlan.apiMd}\n` : ''}

## Test plan
${prd.testPlanMd}

## End-to-end checks
${prd.e2ePlanMd}
`.trim();
};

export const renderRepoCommands = (repos: BuilderRepoDefinition[]): string =>
  repos
    .map(
      (repo) =>
        `- **${repo.repo}** (\`repos/${repo.repo}\`) — ${repo.description}\n` +
        `  - test: \`${repo.test}\`\n` +
        `  - lint: \`${repo.lint}\`\n` +
        `  - typecheck: ${repo.typecheck ? `\`${repo.typecheck}\`` : '(covered by test/build)'}\n` +
        `  - guarded paths: ${repo.guardedPaths.join(', ') || '(none)'}`,
    )
    .join('\n');

/**
 * The compiled-in conduct block.
 *
 * The fallback, not the source of truth — `builder_coder_guidance` is, and it
 * ships as a file carrying this same text. It exists so a missing row, an
 * unreachable database or a typo in the prompt code degrades to the behaviour
 * we already had rather than to a prompt with a hole where its conduct rules
 * should be. A coding agent that has quietly lost "never edit a merged
 * migration" still runs, still opens a pull request, and is simply worse.
 *
 * It references the guarded-path table rendered above it, so it is
 * interpolated in that same position rather than anywhere a caller likes.
 */
export const DEFAULT_CODER_GUIDANCE = `## Conduct

- **Guarded paths** (listed per repo above) cover auth, permissions,
  migrations and payments. A change there gets extra scrutiny in your report
  and must never be incidental — if the PRD did not ask for it, do not do it.
- **Never edit a merged migration.** Add a new one.
- **No secrets** in code, logs, events or PR bodies.
- If you conclude the PRD asks for something wrong or impossible, stop and say
  so via \`ask\`. Building the wrong thing carefully is the expensive failure.`;

export function buildBuildPrompt(context: BuildPromptContext): string {
  const isResume = context.mode === 'resume';

  const header = `${buildPromptHeader({
    sessionId: context.sessionId,
    runId: context.runId,
    branchSlug: context.branchSlug,
    apiBaseUrl: context.apiBaseUrl,
    repos: context.repos,
    role: 'coding agent',
  })}

A PRD is below. Implement it and prove it works.

**You do not open the pull requests.** When you finish coding and testing, this
run continues automatically: a machine test gate runs every touched repo's
suites, then a fresh-context reviewer goes after your diff, and only once both
are satisfied does a final phase commit, push and open the PRs. Nothing you
write reaches a pull request until it has passed both. Stop when the code and
tests are done.`;

  const protocol = `
## Protocol

Follow these in order. Report each stage as you enter it.

**1. \`stage SETUP\`** — read the PRD below. Explore the checked-out repos
enough to know where the change lands. Read what you need and no more; you are
billed for every token and the runner has a wall clock.

**2. \`stage PLANNING\`** — a plan for this run is below, written by a planner
pass with a stronger model. Follow it. Post your initial todo list with
\`todo\`, derived from the plan's workstreams. If the plan is wrong about
something you can now see in the code, say so in your report and deviate
deliberately — do not follow a plan off a cliff.

**3. Ask everything now, once.** If anything material is ambiguous — a
decision the PRD does not settle, a conflict between two requirements, a repo
convention that could go two ways — batch **all** of it into a single \`ask\`
and stop. One pause costs a teardown, a dispatch and a wait on a human; four
pauses cost that four times. See "Pausing" below for the exact shape.

Do NOT ask about things you can determine yourself by reading the code. Do NOT
ask for permission to proceed.

**4. Branch — already done for you.** Every repo under \`repos/\` is already
checked out on ${
    isResume
      ? "the branch holding this session's work in progress"
      : '`builder/' + context.branchSlug + '`'
  }. Commit onto it. Do **not** create a branch, switch branch, or reset to
master${isResume ? ', and do not start over' : ''}.

The test gate compares \`master...HEAD\`, so a commit made on master is
invisible to it: the gate reports the repo unchanged, fails closed, and sends
you to remediate work you have already done. Run \`git branch --show-current\`
if you want to confirm where you are.

**That branch may already carry work.** A previous attempt on this session
pushes to the same branch, and the runner checks it out rather than starting
clean — so \`git log master..HEAD\` and \`git diff master...HEAD\` are the
first things to read. Build on what is there; do not redo it, and do not revert
it because you did not write it. If the change the PRD asks for is already
present and correct, say so and move on rather than rewriting it to your own
taste.

**5. \`stage CODING\`** — implement. Keep the todo list current as you go: mark
an item \`in_progress\` when you start it and \`done\` when it is genuinely
finished, and re-send the whole list. Write code that reads like the code
around it — match the surrounding naming, comment density and idiom rather
than importing a style from elsewhere.

**Work the plan's independent workstreams in parallel — if your toolset can.**
Where the plan marks two workstreams parallel-safe and you have a subagent tool
(\`Task\`), run them as concurrent subagents, one per workstream, each told to
confine itself to that workstream's file list. **If you have no such tool, do
them one after another.** The prompt is shared by every engine and not all of
them have subagents; a plan that assumes one is a plan, not a requirement.
You integrate the results and run the tests yourself. Never let two subagents
hold the same file: a plan that marks overlapping file sets parallel-safe is
wrong, and sequential is the right answer there.

**6. Tests are part of the change, not a step after it.** For each requirement,
write a test that fails for the right reason before you make it pass. A test
written after the fact tends to assert what the code does rather than what the
requirement asked for.

**7. Docs are part of the change, the same way tests are.** This platform
enforces them in CI — \`.docs-map.yml\` declares which docs cover which code and
the "Docs guard" check fails the pull request when one is missed. Two rules
reach ordinary feature work:

- Touched a \`*.entity.ts\`? Update \`DATA_SCHEMA.md\` **in the same commit**. It
  is the platform-wide map of what data exists, and an entity change that
  skips it makes the map wrong for every repo that reads it.
- Touched \`src/app.module.ts\` or a \`*.gateway.ts\`? That needs a wiki page
  updated, which you cannot do from in here. Say so plainly in your closing
  summary so the finalise phase can declare it on the PR.

Read the repo's own \`.docs-map.yml\` rather than trusting this list — it is the
source of truth, and it grows.

**8. \`stage TESTING\`** — check **what you changed**, not the whole repo.

For every repo you touched, in this order:

1. Its **typecheck** and **lint** commands from the table above. Both are fast
   and both are hard gates later, so there is no reason to defer them.
2. The specs you wrote or edited, by path.
3. The **blast radius**: grep for other callers of every symbol whose signature
   or behaviour you changed, and run their suites — by path, or with the
   affected-only command from the table (\`affectedTest\`) where the repo has one.
   Most regressions this agent could cause are here, not in the code you were
   looking at.

**Do not run a whole repo's suite.** The gate does that once, on a clean tree,
after you stop — it is the run's only machine evidence and it is not optional,
so a full pass here is the same work done twice. On the first real build that
duplication was most of the coder's wall clock: twenty of thirty-three minutes
inside tool calls, and nearly all of it suites the gate then ran again.

Pipe anything long through \`tail -60\`. A full suite's output in your context is
tens of thousands of tokens you will re-read on every later turn, and the part
that matters is the failure list at the end.

The same applies to everything you read. This phase is charged for its whole
context on every turn, and a coding pass runs well over a hundred turns:

- Prefer \`Grep\` and a \`Read\` with a line range over reading a whole file. A
  2,000-line service read in full is paid for a hundred more times.
- When a subagent finishes (if you used one), write down what you needed from it in a few
  lines and work from that, not from its full transcript.
- Do not re-read a file you have already read unless you changed it.

Post what you ran and what it said with \`note test_output "…"\`.

Fix what you broke. If a test was already failing before your change, say so
in your report rather than fixing it silently — an unrelated fix buried in a
feature PR is a bad review, and the gate compares against a baseline so it will
not blame you for it.

**9. Stop.** Commit your work on each repo you touched (imperative message,
describing the change rather than the process) but **do not push and do not
open a PR** — the finalise phase does that once the gate and the reviewer are
satisfied. Then post a short summary of what you did with
\`note text "…"\` and exit. Do not call \`complete-run\`.

## Pausing to ask

When you need a person, write a JSON file and call \`ask\` with it:

\`\`\`json
{
  "questions": [
    {
      "prompt": "One clear question.",
      "rationale": "Why this is blocking, and what the PRD leaves open.",
      "kind": "singleSelect",
      "allowCustom": true,
      "options": [
        {"id": "a", "label": "Short label", "description": "The trade-off in one line.", "recommended": true},
        {"id": "b", "label": "Short label", "description": "The trade-off in one line."}
      ]
    }
  ],
  "branches": {"ally-be": "builder/${context.branchSlug}"}
}
\`\`\`

Rules, the same ones the interview follows:

- Offer 2-4 concrete options with a one-line trade-off each, and mark exactly
  one \`recommended\`. Free text only where the question is genuinely open.
- \`allowCustom\` is always true. An option list a person cannot step outside
  of forces a wrong answer.
- Say what you would do if nobody answered, in the rationale.

**Before you call \`ask\`:** commit whatever you have on every dirty repo
(\`wip(builder): pause for input [skip ci]\`) and push, then include those
branches in \`branches\`. Then **exit 0**. Pausing is a success, not a failure —
the run ends here and a fresh run resumes from your branches when the answer
arrives. Uncommitted work at this point is work thrown away.

${context.guidance?.trim() || DEFAULT_CODER_GUIDANCE}
`.trim();

  const resumeBlock = isResume
    ? `
## This is a resume run

${
  context.answeredQuestions?.length
    ? `The questions you paused on have been answered:\n\n${context.answeredQuestions
        .map((qa) => `- **${qa.prompt}**\n  → ${qa.answer}`)
        .join('\n')}\n`
    : ''
}${
        context.branches && Object.keys(context.branches).length
          ? `Check out these branches — they hold your work in progress:\n\n${Object.entries(
              context.branches,
            )
              .map(([repo, branch]) => `- \`repos/${repo}\` → \`${branch}\``)
              .join('\n')}\n`
          : ''
      }
${context.resumeContext ? `\n### Where you left off\n\n${context.resumeContext}\n` : ''}
Continue from there. Do not restart, do not re-plan from scratch, and re-run
the tests before you stop — the answer you just received may have changed
something you had already tested.
`.trim()
    : '';

  const lessonsBlock = context.lessons.length
    ? `
## Lessons from previous Builder runs

These were learned the hard way on this platform. They are advisory, not
requirements.

${context.lessons.map((lesson) => `- ${lesson}`).join('\n')}
`.trim()
    : '';

  const milestone = context.milestone;
  const milestoneBlock = milestone
    ? `
## This run builds milestone ${milestone.position} of ${milestone.total}

**${milestone.title}**

${milestone.summaryMd ?? ''}

**Your requirements are ${milestone.requirementIds.join(', ') || '(none listed — treat that as a gap and say so)'}.**
The PRD below is the whole feature; everything outside those requirement ids
belongs to another milestone. Do not build ahead: a later milestone's work
appearing in this pull request is the thing that makes a stacked series
unreviewable.

${
  milestone.completed.length
    ? `### Already built, in earlier milestones

${milestone.completed
  .map(
    (done) => `- **${done.position}. ${done.title}** — on \`${done.branch}\``,
  )
  .join('\n')}

You may rely on all of it. It is in the branch you are starting from, whether or not anyone has merged it yet.`
    : 'This is the first milestone, so nothing has been built yet.'
}

${
  milestone.baseBranch
    ? `### Branching

Branch from \`${milestone.baseBranch}\` — **not** from master — so this milestone stacks on the last one. When you open the pull request, set its base to \`${milestone.baseBranch}\` too (\`gh pr create --base ${milestone.baseBranch}\`); GitHub retargets it automatically once that one merges.`
    : ''
}

${
  milestone.technicalNotesMd
    ? `### Notes for this slice

${milestone.technicalNotesMd}`
    : ''
}
`.trim()
    : '';

  const exemplarBlock = context.exemplars?.length
    ? `
## Similar builds this platform has already attempted

What happened *after* each shipped is the useful part. A rejected approach is
worth more to you here than a successful one.

${context.exemplars.join('\n\n')}
`.trim()
    : '';

  return [
    header,
    protocol,
    milestoneBlock,
    resumeBlock,
    lessonsBlock,
    exemplarBlock,
    renderPrd(context.prd),
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');
}
