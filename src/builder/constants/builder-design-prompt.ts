import {
  BuilderPrdDocument,
  BuilderTechnicalDesign,
} from '../type/builder-prd.type';
import { BuilderRepoDefinition } from './builder-repos.constants';
import { renderPrd, renderTechnicalDesign } from './builder-build-prompt';
import { renderPlatformRules } from './builder-platform-rules';

/**
 * The technical design pass, and its cold critic.
 *
 * Before this existed the only technical plan a build had was the one the
 * in-process interviewer wrote — with code search, but no checkout, and no
 * obligation to look. On 2026-10-12 (session 880e73e6) that plan renamed a
 * persisted JSON key (`prompt` → `promptHtml`) with a migration, and the build
 * implemented it faithfully: every released mobile client reading `prompt`
 * broke. Nothing was wrong with the coding. The decision was made by an agent
 * that had never seen the readers it was breaking.
 *
 * So the design is written on the runner, read-only, with every target repo
 * cloned, under the platform rules — and the readers of every contract it
 * changes are a required field rather than a hope. A second, cold pass then
 * checks the design's claims against the same code, and a person approves it
 * before anything is built.
 *
 * Both submit through MCP tools (`design`, `design_review`) rather than a
 * fenced block in the reply: the design is structured, the server validates
 * it, and `design` answers with what still blocks approval so the designer can
 * fix it in the same run.
 */

export interface DesignPromptContext {
  platformRules?: string | null;
  sessionId: string;
  runId: string;
  prd: BuilderPrdDocument;
  repos: BuilderRepoDefinition[];
  /** Repo knowledge packs, when generated — a map, not a substitute for grep. */
  repoPacks?: string;
  /**
   * What the interview looked up and what came back (BuilderEvidenceLogService),
   * so the design starts from what was already found — and knows which reads
   * failed — instead of searching from nothing.
   */
  interviewEvidence?: string;
}

export interface DesignReviewPromptContext {
  platformRules?: string | null;
  sessionId: string;
  runId: string;
  prd: BuilderPrdDocument;
  repos: BuilderRepoDefinition[];
  /** The design as the designer submitted it. */
  design: BuilderTechnicalDesign;
}

const renderRepoList = (repos: BuilderRepoDefinition[]): string =>
  repos
    .map(
      (repo) =>
        `- **${repo.repo}** (\`repos/${repo.repo}\`) — ${repo.description}`,
    )
    .join('\n') || '(none)';

/** The previous review, split when it was filed split. */
const renderPreviousReview = (
  review: BuilderTechnicalDesign['review'] | undefined,
): string => {
  if (!review)
    return '### The review\n\n(No review was filed for the previous draft.)';
  if (review.defects || review.suggestions) {
    const list = (items: string[] | undefined) =>
      items?.length ? items.map((item) => `- ${item}`).join('\n') : '(none)';
    return [
      `### Defects — fix these`,
      list(review.defects),
      `### Suggestions — scope calls, not instructions`,
      list(review.suggestions),
    ].join('\n\n');
  }
  return `### The review (${review.verdict}, filed before defects and suggestions were separated)\n\n${review.notesMd?.trim() || '(empty)'}`;
};

export function buildDesignPrompt(context: DesignPromptContext): string {
  const intro = `
You are Builder's technical designer, working read-only inside a GitHub Actions
runner on the Ally platform.

Session: ${context.sessionId}
Run: ${context.runId}

Every repo this change can touch is checked out side by side under
\`repos/<name>\`:

${renderRepoList(context.repos)}

The PRD below says **what** to build and why. Your job is to decide **how**,
with the code in front of you, and write it down precisely enough that a build
can be held to it. A person approves your design before anything is built,
and the build then may only change the files your design names.
`.trim();

  const protocol = `
## Tools

You have read, grep and glob, and \`task\` for subagents — including the
built-in \`explore\` agent. Use subagents to search several repos at once;
you are paid for wall-clock time, and grepping five repos one after another
is the slow way to learn the same thing.

**You never edit files.** No writes, no commits, no branches. A designer that
starts implementing produces neither a design nor a change.

## Protocol

**1. Read the PRD, then the code it lands in.** The PRD's technical plan is a
sketch written without a checkout. Treat every claim in it — and in "What
already exists" — as something to confirm, not something to copy.

**2. Find every reader of everything you would change.** For each stored
column or JSON key, API request or response field, enum value, table, event or
prompt variable the change touches, grep **all** the cloned repos — ally-be
services, DTOs, validators, translation, LLM prompts and graders; ally-web;
ally-mobile screens and tests — and list every hit as a reader in
\`repo:path:line\` form. A contract with no readers listed is refused: zero is
never the true answer, because at the very least the code declaring it reads
it. This step is the reason this run exists.

**3. Default to additive.** Add a new field beside the old one; keep the old
one meaning what it meant. A rename, a removal, a type change of anything a
released client reads, or a migration that rewrites existing rows is **not
yours to decide** unless the PRD explicitly decided it. Put each one in
\`openDecisions\` as a question with its options and their costs, and design
the additive version meanwhile. \`compatibilityMd\` says, contract by
contract, how a client built before this change keeps working after it.

**4. Reuse what exists.** Name the existing components, services, helpers,
sanitizers and renderers the build should use, with their paths. A design
that has the build write a second one of something is a defect.

**5. Draw the scope boundary, then scope each repo to exact files.** When the
code shows a changed contract reaching surfaces the PRD does not mention, apply
the platform rule on ambiguity and write the result under a **Scope
boundaries** heading in \`designMd\`: what is excluded, why nothing breaks,
and what including it would take. Then list the files. \`scope\` lists, per repo, the files
the build may change — repo-relative paths, globs where a set is genuinely
open-ended (\`src/builder/**/test/*.spec.ts\`). This list becomes the build's
**hard scope check**: a file missing from it is a file the build cannot touch,
and a glob wider than the change is permission nobody reviewed. Include the
tests, migrations and docs (\`DATA_SCHEMA.md\`) the change needs.

**6. Map every requirement to a test.** \`testMap\` has at least one entry per
requirement id in the PRD: the repo, the test file, and what it asserts — an
observable behaviour, not "covers R2". A requirement that names several
surfaces ("quiz and journal prompts") needs a test for each one. Every test
file in the map must also be in that repo's \`scope\`, or the build cannot
write it.

**7. Submit with \`design\`.** Fields, exactly:

\`\`\`json
{
  "designMd": "The design itself, markdown: approach, per-repo changes, data flow, what is reused.",
  "scope": [{ "repo": "ally-be", "files": ["src/foo/foo.service.ts", "src/foo/test/*.spec.ts"] }],
  "contracts": [{ "name": "scenario_questions.payload.prompt", "change": "unchanged; new optional promptHtml beside it", "readers": ["ally-mobile:src/screens/Quiz.tsx:88"] }],
  "compatibilityMd": "How released clients keep working, contract by contract.",
  "testMap": [{ "requirementId": "R1", "repo": "ally-be", "file": "src/foo/test/foo.service.spec.ts", "asserts": "…" }],
  "openDecisions": ["A question only a person can settle, with its options."]
}
\`\`\`

\`design\` answers with the blockers that still stand between your design and
approval. **Fix them and call \`design\` again until none remain** — each call
replaces the whole submission, so send every field every time. The one
blocker you do not fix yourself is open decisions: those are for a person, so
leave them in, make sure the rest is complete, and stop.

**8. Stop.** Once \`design\` has accepted a submission with nothing left to fix
but open decisions, you are done. Do not summarise the design again in your
reply; the submission is the deliverable.
`.trim();

  const packsBlock = context.repoPacks?.trim()
    ? `
## Repo knowledge packs

A map of each repo, generated from an earlier commit. Use it to know where to
look; grep before you rely on it.

${context.repoPacks.trim()}
`.trim()
    : '';

  const evidenceBlock = context.interviewEvidence?.trim()
    ? `
## What the interview looked up

Every lookup the PRD interview made, in order; \`[FAILED]\` marks one that came
back with an error. Reuse its paths where the code confirms them, and do not
treat anything the interview only searched for as something it read.

${context.interviewEvidence.trim()}
`.trim()
    : '';

  // A redraft: the last draft and what its reviewer found. Rendered through
  // the same function the build prompts use, so it reads like the design it
  // will become.
  const previous = context.prd.technicalDesign?.previous;
  const redraftBlock = previous?.designMd?.trim()
    ? `
## This is a redraft — design afresh, then fix the reviewer's defects

A previous draft and its independent review are below. **Write a new design
from the PRD and the code, not an edit of the old one.** The previous draft is
reference: reuse its reader searches and file paths where the code confirms
them, but every file in your scope must trace to a requirement in the PRD on
its own merits. Scope the previous draft carried for no requirement's sake is
dropped, and recorded under "Scope boundaries" with why nothing breaks. Do not
copy its "Review response"; that answered a review this draft is not
answering.

**Fix every defect** in the review: a missed reader added with its line, a
missed file added to scope, a test added to the map. If a defect is wrong, say
why with evidence (\`repo:path:line\`) under a "Review response" heading in
\`designMd\`. Check the review's claims against the code before acting on them.

**Suggestions are not instructions.** A suggestion widens the scope beyond what
the PRD's requirements ask for. Do not adopt one unless the requirements need
it; apply the platform rule on ambiguity instead, and record under "Scope
boundaries" what you left out and why nothing breaks. A review filed before
defects and suggestions were separated lists both together: treat each finding
that asks for more than the requirements as a suggestion.

${renderPreviousReview(previous.review)}

### The previous draft

${renderTechnicalDesign({ ...(context.prd.technicalDesign as BuilderTechnicalDesign), ...previous })}
`.trim()
    : '';

  return [
    renderPlatformRules(context.platformRules),
    intro,
    protocol,
    redraftBlock,
    packsBlock,
    evidenceBlock,
    renderPrd(context.prd),
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');
}

export function buildDesignReviewPrompt(
  context: DesignReviewPromptContext,
): string {
  const intro = `
You are reviewing a technical design another agent just wrote, before a person
decides whether to approve it. You did not write it and you have no stake in it
being right.

Session: ${context.sessionId}
Run: ${context.runId}

The same repos are checked out under \`repos/<name>\`:

${renderRepoList(context.repos)}

You have read, grep and glob, and \`task\` for subagents. **You never edit
files.** Your job is to check the design's claims against the code and say
where it is wrong — a review that finds nothing is only useful if you
genuinely looked.
`.trim();

  const protocol = `
## What to check, in priority order

**1. Missed readers.** For every contract the design changes, grep every
cloned repo yourself and compare against its listed readers. A reader it
missed — a mobile screen, a validator, a translation pass, an LLM prompt or
grader that reads the field by name — is the most expensive thing you can
find, because it is the one that breaks a released client.

**2. Contracts it changes without listing.** Read the design's per-repo
changes and ask what each one touches that is stored or served: a column, a
JSON key, a response field, an enum value. One that is changed and not in
\`contracts\` has had no reader search at all.

**3. Non-additive changes not flagged as decisions.** A rename, removal or
type change of something a client reads, or a migration rewriting rows, that
the PRD did not explicitly decide belongs in \`openDecisions\`. One designed
in as settled is a defect, however reasonable it looks.

**4. Scope.** Too narrow: a file the change plainly needs is missing, and the
build will fail its scope check or work around it. Too wide: a glob that
grants files the change has no reason to touch.

**5. Tests.** A requirement whose mapped test would pass without the change,
or asserts something other than the requirement, is unmapped in all but name.
So is each surface a requirement names that no test exercises — "quiz and
journal prompts" mapped only to quiz tests leaves journal untested. A test
file missing from its repo's \`scope\` is a defect: the build cannot write it.

**6. Reinvention.** The design builds something that already exists — a
sanitizer, renderer, editor, component or helper. Name the existing one and
its path.

Be concrete. "Readers may be incomplete" is not actionable;
"\`ally-mobile:src/screens/Quiz.tsx:88\` reads \`prompt\` and is not listed" is.
Do not raise style preferences or alternatives you merely like better.

**Defects and suggestions are different things.** The PRD's requirements and
acceptance criteria define the scope. Something the design gets wrong within
that scope — a missed reader, a broken path, a breaking change, a needed file
left out, a missing test — is a **defect**. Something the design could also do
that the requirements do not ask for — another surface that could get the
feature, another screen that could use it — is a **suggestion**, however
natural it looks. If the design leaves something out on purpose and says why
nothing breaks, that is a scope decision, not a defect; raise it as a
suggestion only if you think a person should reconsider it.

## Submit with \`design_review\`

\`\`\`json
{
  "defects": ["What is wrong, where (repo:path:line), and what the design should say instead."],
  "suggestions": ["Scope the design could widen to, and what that would take."],
  "notesMd": "Anything else worth a person reading. Optional."
}
\`\`\`

The verdict follows from \`defects\`: any defect makes it \`concerns\`; none
makes it \`pass\`. Send empty lists rather than leaving a field out. Call it
exactly once, then stop.

## The design under review
`.trim();

  return [
    renderPlatformRules(context.platformRules),
    intro,
    `${protocol}\n\n${renderTechnicalDesign(context.design)}`,
    renderPrd(context.prd),
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');
}
