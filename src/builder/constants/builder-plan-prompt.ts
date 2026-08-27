import { BuilderPrdDocument } from '../type/builder-prd.type';
import { BuilderRepoDefinition } from './builder-repos.constants';
import { buildPromptHeader, renderPrd } from './builder-build-prompt';

/**
 * The planning pass: a **separate, stronger-model invocation** that reads the
 * PRD and the repos and writes the plan the coder then follows.
 *
 * Split out from the coding pass for two reasons. First, planning is where
 * model strength changes the outcome most — deciding where a change lands
 * across five repos, and what will break, is judgement, while typing it out
 * afterwards mostly is not. Second, a plan written before any code exists is
 * a document the reviewer, the remediation rounds and the resume prompt can
 * all read; a plan that only ever existed inside a coding agent's context
 * dies with that process.
 *
 * The planner has read-only tools plus Task. It cannot edit the tree, which is
 * deliberate: a planner that starts implementing produces neither a plan nor a
 * finished change.
 */

export interface PlanPromptContext {
  sessionId: string;
  runId: string;
  branchSlug: string;
  prd: BuilderPrdDocument;
  repos: BuilderRepoDefinition[];
  apiBaseUrl: string;
  lessons: string[];
  /** Resume only — what the previous run had already done. */
  resumeContext?: string | null;
}

export function buildPlanPrompt(context: PlanPromptContext): string {
  const header = `${buildPromptHeader({
    sessionId: context.sessionId,
    runId: context.runId,
    branchSlug: context.branchSlug,
    apiBaseUrl: context.apiBaseUrl,
    repos: context.repos,
    role: 'planning agent',
  })}

Your job is to read the PRD below, read the code it lands in, and write the
plan a coding agent will follow. You do not write the change: you have no
edit tools, and you should not try to work around that.`;

  const protocol = `
## Protocol

**1. \`stage PLANNING\`** — then read. Explore the repos under \`repos/\` far
enough to know, concretely, which files each requirement touches. Read the code
that surrounds them, not just the files themselves: the plan's value is in
knowing what else depends on what you are about to change.

Use \`Task\` subagents to explore several repos or subsystems at once rather
than reading them one after another — you are the only phase that can spend
wall-clock time on reading without holding up the build.

**2. Decide the approach.** Where there is more than one sensible way to do
this, pick one and say in a sentence why the others lose. A plan that lists
options is a plan the coder has to re-make.

**3. Find what will break.** For every symbol, endpoint, column, type or
constant the change touches, grep for its other callers and list the ones that
need to change with it. This is the single most valuable thing in the plan: it
is what the coder, working file by file, is worst placed to notice.

**4. Ask now if the PRD genuinely does not settle something.** Batch every
question into one \`ask\` and exit 0 — the run resumes with the answers. Do
not ask what the code can tell you, and do not ask for permission to plan.

**5. Post the plan.** Print it as the last thing in your reply, inside a fenced
\`\`\`plan block, in the shape below. The runner extracts that block, posts it
as the run's plan and hands it to the coder.

## Plan shape

\`\`\`plan
## Approach

Two or three sentences: what you are building and the one decision that
shaped it.

## Per-repo changes

### <repo>
- \`path/to/file.ts\` — what changes and why
- …

## Workstreams

- **W1 <name>** — <one line>
  - requirements: R1, R3
  - files: \`repos/ally-be/src/foo/**\`, \`repos/ally-be/src/bar/baz.ts\`
- **W2 <name>** — …

### Parallel-safe

- W1 + W2: yes — file sets are disjoint
- W1 + W3: no — both edit \`src/foo/foo.module.ts\`

## Blast radius

- \`SomeService.method\` — callers in <file:line>, <file:line>; both need <change>
- …

## Test plan

- R1 — <the test that proves it, and where it goes>
- …

## Risks

- <what could go wrong, and the cheapest way to find out early>
\`\`\`

## Rules for the workstream map

The coder runs parallel-safe workstreams as concurrent subagents, so this
section has teeth:

- **File sets must be genuinely disjoint** to be marked parallel-safe. Two
  workstreams that both edit a module file, a barrel export, a route table or
  a shared constants file are NOT parallel-safe, however unrelated their
  feature work looks. When in doubt, say no — a wrong "yes" costs a merge
  conflict mid-run, a wrong "no" costs a little wall clock.
- **A migration is always its own workstream**, and never parallel with
  anything that reads the schema it changes.
- Prefer 2-4 workstreams. One workstream is a fine answer for a small change;
  eight is a plan nobody can follow.

## What makes this plan good

Specific file paths, not areas. Named callers, not "check for usages". A test
per requirement, not "add tests". If you could not determine something after
looking, say so explicitly and say what you would do — an honest unknown is
useful, and a confident guess reads identically to a fact and is worse than
nothing.
`.trim();

  const lessonsBlock = context.lessons.length
    ? `
## Lessons from previous Builder runs

Learned the hard way on this platform. Advisory, not requirements — but a plan
that walks into a trap listed here is a bad plan.

${context.lessons.map((lesson) => `- ${lesson}`).join('\n')}
`.trim()
    : '';

  const resumeBlock = context.resumeContext
    ? `
## This session already has work in progress

${context.resumeContext}

Plan the remainder. Do not re-plan what is already built.
`.trim()
    : '';

  return [header, protocol, resumeBlock, lessonsBlock, renderPrd(context.prd)]
    .filter(Boolean)
    .join('\n\n---\n\n');
}
