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

## Repos and their commands

${renderRepoCommands(context.repos)}
`.trim();
}

/**
 * Shell helpers embedded verbatim in the prompt.
 *
 * Pre-built rather than described, because a model asked to "POST an event"
 * writes a slightly different curl every time, and a malformed one fails
 * silently in the middle of a two-hour run. The `|| true` on each is
 * deliberate: telemetry must never be able to fail a build.
 */
const buildHelpers = (apiBaseUrl: string, runId: string): string => {
  const base = `${apiBaseUrl}/api/v1/builder/pipeline/runs/${runId}`;
  return `
### Reporting helpers

Every helper below is a shell command you run directly. They are how the
person watching this build sees what you are doing — a stage you never
report is a stage that looks like it never happened.

\`\`\`bash
# Move to a new stage. Call this the moment you start it, not when you finish.
stage() {
  curl -sS -X POST "${base}/events" -H "x-api-key: $ALLY_BE_API_KEY" \\
    -H 'Content-Type: application/json' \\
    -d "{\\"events\\":[{\\"type\\":\\"stage_change\\",\\"payload\\":{\\"stage\\":\\"$1\\"}}]}" >/dev/null || true
}

# Replace the whole todo list. Send the FULL list every time, not a delta.
# jsonFile holds: [{"id":"1","text":"...","status":"pending|in_progress|done"}]
todo() {
  curl -sS -X POST "${base}/events" -H "x-api-key: $ALLY_BE_API_KEY" \\
    -H 'Content-Type: application/json' \\
    -d "{\\"events\\":[{\\"type\\":\\"todo\\",\\"payload\\":{\\"items\\":$(cat "$1")}}]}" >/dev/null || true
}

# A free-text milestone of a given type (plan, test_output, verification, …).
note() {
  jq -n --arg t "$1" --arg b "$2" \\
    '{events:[{type:$t,payload:{text:$b}}]}' \\
  | curl -sS -X POST "${base}/events" -H "x-api-key: $ALLY_BE_API_KEY" \\
      -H 'Content-Type: application/json' -d @- >/dev/null || true
}

# Pause and ask. Body is a JSON file: {"questions":[…],"branches":{…}}
# The marker file is what tells the runner this exit was a pause rather than a
# finish — without it the verification pass would run over half-built work.
ask() {
  curl -sS -X POST "${base}/questions" -H "x-api-key: $ALLY_BE_API_KEY" \\
    -H 'Content-Type: application/json' -d @"$1" \\
  && touch /tmp/builder-paused
}

# What is left of this session's spend ceiling. Worth checking before
# anything expensive (an E2E bring-up, a long test matrix): a run that is over
# the ceiling stops at the next phase boundary and waits there for an admin to
# raise it, which is time your work spends unfinished rather than money saved.
budget() {
  curl -sS "${base}/budget" -H "x-api-key: $ALLY_BE_API_KEY" || true
}

# Record opened pull requests. Body: {"pullRequests":[{repo,branch,prNumber,prUrl,title}]}
prs() {
  curl -sS -X POST "${base}/prs" -H "x-api-key: $ALLY_BE_API_KEY" \\
    -H 'Content-Type: application/json' -d @"$1" >/dev/null || true
}

# Your written account of the run. Body: {"type":"run_report","contentMd":"…","metrics":{…}}
report() {
  curl -sS -X POST "${base}/report" -H "x-api-key: $ALLY_BE_API_KEY" \\
    -H 'Content-Type: application/json' -d @"$1" >/dev/null || true
}

# Finish. Body: {"outcome":"done"|"failed","error":"…"}
complete() {
  curl -sS -X POST "${base}/complete" -H "x-api-key: $ALLY_BE_API_KEY" \\
    -H 'Content-Type: application/json' -d "$1" >/dev/null || true
}
\`\`\`
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

**4. Branch.** ${
    isResume
      ? 'This is a RESUME run. The branches below already exist and hold work in progress — check each one out. Do NOT branch from master and do NOT start over.'
      : 'In each repo you will change, create `builder/' +
        context.branchSlug +
        '` from an up-to-date master.'
  }

**5. \`stage CODING\`** — implement. Keep the todo list current as you go: mark
an item \`in_progress\` when you start it and \`done\` when it is genuinely
finished, and re-send the whole list. Write code that reads like the code
around it — match the surrounding naming, comment density and idiom rather
than importing a style from elsewhere.

**Work the plan's independent workstreams in parallel.** Where the plan marks
two workstreams parallel-safe, run them as concurrent \`Task\` subagents — one
per workstream, each told to confine itself to that workstream's file list.
You integrate the results and run the tests yourself. Never let two subagents
hold the same file: a plan that marks overlapping file sets parallel-safe is
wrong, and sequential is the right answer there.

**6. Tests are part of the change, not a step after it.** For each requirement,
write a test that fails for the right reason before you make it pass. A test
written after the fact tends to assert what the code does rather than what the
requirement asked for.

**7. \`stage TESTING\`** — check **what you changed**, not the whole repo.

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

Post what you ran and what it said with \`note test_output "…"\`.

Fix what you broke. If a test was already failing before your change, say so
in your report rather than fixing it silently — an unrelated fix buried in a
feature PR is a bad review, and the gate compares against a baseline so it will
not blame you for it.

**8. Stop.** Commit your work on each repo you touched (imperative message,
describing the change rather than the process) but **do not push and do not
open a PR** — the finalise phase does that once the gate and the reviewer are
satisfied. Then post a short summary of what you did with
\`note text "…"\` and exit. Do not call \`complete\`.

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

## Conduct

- **Guarded paths** (listed per repo above) cover auth, permissions,
  migrations and payments. A change there gets extra scrutiny in your report
  and must never be incidental — if the PRD did not ask for it, do not do it.
- **Never edit a merged migration.** Add a new one.
- **No secrets** in code, logs, events or PR bodies.
- If you conclude the PRD asks for something wrong or impossible, stop and say
  so via \`ask\`. Building the wrong thing carefully is the expensive failure.
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
