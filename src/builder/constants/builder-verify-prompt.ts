import { BuilderPrdDocument } from '../type/builder-prd.type';
import { BuilderRepoDefinition } from './builder-repos.constants';

/**
 * The verification pass, run as a **second engine invocation with a fresh
 * context** after the coding agent finishes testing.
 *
 * Fresh context is the entire point. The coding agent has spent an hour
 * convincing itself its approach is right; asking it to review its own diff
 * mostly produces agreement. A reader who has seen only the PRD and the diff
 * has no such investment, and the things this is looking for — a requirement
 * quietly dropped, a caller elsewhere that now breaks, a state nobody
 * designed — are exactly the ones the author is worst placed to notice.
 *
 * The output is a verdict the runner acts on, so it is JSON, not prose.
 */

export interface VerifyPromptContext {
  prd: BuilderPrdDocument;
  repos: BuilderRepoDefinition[];
  /** Round 1 or 2 — the second round is told what was already raised. */
  round: number;
  previousObjections?: string[];
}

export function buildVerifyPrompt(context: VerifyPromptContext): string {
  const guarded = context.repos
    .map(
      (repo) =>
        `- **${repo.repo}**: ${repo.guardedPaths.join(', ') || '(none listed)'}`,
    )
    .join('\n');

  const requirements = (context.prd.requirements ?? [])
    .map((requirement) => {
      const criteria = Array.isArray(requirement.acceptanceCriteria)
        ? requirement.acceptanceCriteria
        : [];
      return `- **${requirement.id}** ${requirement.title}: ${requirement.description}${
        criteria.length ? `\n  - ${criteria.join('\n  - ')}` : ''
      }`;
    })
    .join('\n');

  const roundNote =
    context.round > 1 && context.previousObjections?.length
      ? `
This is round ${context.round}. These objections were raised last round and
the agent has since tried to address them — check each one specifically, and
say whether it is now resolved:

${context.previousObjections.map((objection) => `- ${objection}`).join('\n')}
`.trim()
      : '';

  return `
You are reviewing a change another agent just wrote, before it becomes a pull
request. You did not write it and you have no stake in it being right.

Your job is to **find what is wrong with it**. A review that finds nothing is
only useful if you genuinely looked; assume there is something and go after it.

${roundNote}

## What to check, in priority order

**1. Requirement coverage.** For each requirement below, find the code that
implements it and the test that proves it. A requirement with no test, or with
a test that asserts what the code happens to do rather than what the
requirement asked for, is a gap — say so and name it.

${requirements || '(no requirements listed — that is itself worth reporting)'}

**2. Regressions in things nobody was looking at.** This is the highest-value
check and the one the author is worst placed to do. For every function,
endpoint, type, column or constant the diff changed, find its *other* callers
and decide whether they still work. Pay particular attention to:
   - a changed function signature or return shape;
   - a narrowed type or enum that something else still sends the old value to;
   - a shared component whose props or behaviour moved;
   - a query or index the change makes slower on real data volumes.

**3. Guarded paths.** Any diff touching these needs a reason that traces back
to the PRD. An incidental change here is a finding regardless of whether it
works:

${guarded}

Migrations get their own scrutiny: editing an already-merged migration is
always wrong, and a new one that alters an existing table must be safe to run
against production data.

**4. States nobody designed.** Empty, loading, error, partial, offline,
too-many, too-few, zero, one. A feature that only works on the happy path is
not finished, and this is the most common thing an implementer skips.

**5. Things the diff does that the PRD did not ask for.** Scope that crept in
is scope nobody reviewed.

## How to work

Read the diff in each repo (\`git diff master...HEAD\`), then read the
surrounding code — the diff alone will not tell you whether a caller broke.
Run any test you want to check a suspicion; you have the same tools.

Be concrete. "Error handling could be better" is not actionable. "\`getUser\`
now returns null for a deleted user, and \`AuthService.resolve\` at
src/auth/auth.service.ts:112 dereferences it without a check" is.

Do not raise style preferences, naming you would have chosen differently, or
anything you cannot tie to a behaviour that is wrong.

## Output

End your reply with exactly one JSON block and nothing after it:

\`\`\`json
{
  "verdict": "pass" | "fail",
  "objections": [
    {
      "severity": "blocking" | "concern",
      "repo": "ally-be",
      "file": "src/…",
      "summary": "One sentence naming the defect.",
      "detail": "What breaks, under what input or state, and how to confirm it."
    }
  ],
  "checkedRequirements": [{"id": "R1", "covered": true, "note": ""}],
  "notes": "Anything worth a reviewer's attention that is not an objection."
}
\`\`\`

\`fail\` if any objection is \`blocking\` — meaning it would be wrong to open
this as a PR. A \`concern\` is worth writing down and does not block.
`.trim();
}
