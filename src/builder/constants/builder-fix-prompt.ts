import { BuilderPrdDocument } from '../type/builder-prd.type';
import { BuilderRepoDefinition } from './builder-repos.constants';
import { buildPromptHeader, renderPrd } from './builder-build-prompt';

/**
 * The fix pass: act on what happened to a pull request after Builder opened it
 * — a failing check, or a human's review comments.
 *
 * This is the phase that makes Builder finish work rather than hand it over.
 * A PR with red CI or three unanswered comments is not shipped, and the person
 * who has to chase it is the reviewer.
 *
 * Deliberately narrower than a build. There is no plan to make — the work is a
 * list of specific complaints — and no independent reviewer, because CI and an
 * actual human reviewer are already the second pair of eyes. The machine gate
 * still runs: "fixes the comment, breaks a test" is exactly what a fix pass is
 * prone to.
 *
 * The rules about *how* to answer a person matter as much as the code here.
 * An agent pushing commits to a branch someone is reviewing can be genuinely
 * useful or can be the reason they stop reviewing at all, and the difference is
 * whether it engages with what they said.
 */

export interface FixFeedbackItem {
  id: string;
  kind: string;
  author?: string | null;
  body?: string | null;
  path?: string | null;
  line?: number | null;
}

export interface FixPromptContext {
  sessionId: string;
  runId: string;
  branchSlug: string;
  prd: BuilderPrdDocument;
  repos: BuilderRepoDefinition[];
  apiBaseUrl: string;
  /** The pull request being fixed. */
  pullRequest: {
    repo: string;
    branch: string;
    prNumber: number;
    prUrl: string;
    ciStatus?: string | null;
  };
  feedback: FixFeedbackItem[];
  /** How many fix runs this PR has had, including this one. */
  attempt: number;
  maxAttempts: number;
}

const renderFeedback = (items: FixFeedbackItem[]): string =>
  items
    .map((item) => {
      const where = item.path
        ? ` — \`${item.path}${item.line ? `:${item.line}` : ''}\``
        : '';
      const who =
        item.kind === 'ci_failure' ? 'CI' : (item.author ?? 'a reviewer');
      return [
        `### ${item.kind === 'ci_failure' ? 'Failing check' : 'Review comment'}${where}`,
        `feedbackId: \`${item.id}\``,
        `from: ${who}`,
        '',
        (item.body ?? '(no text)').trim(),
      ].join('\n');
    })
    .join('\n\n---\n\n');

export function buildFixPrompt(context: FixPromptContext): string {
  const { pullRequest } = context;

  const header = `${buildPromptHeader({
    sessionId: context.sessionId,
    runId: context.runId,
    branchSlug: context.branchSlug,
    apiBaseUrl: context.apiBaseUrl,
    repos: context.repos,
    role: 'fix agent',
  })}

You are working on an **open pull request** that Builder already raised:
${pullRequest.repo}#${pullRequest.prNumber} — ${pullRequest.prUrl}
Branch: \`${pullRequest.branch}\`${
    pullRequest.ciStatus ? `\nCI: ${pullRequest.ciStatus}` : ''
  }

A human may be reading this pull request right now. Every commit you add shows
up in their review, so make each one worth the interruption.

This is fix attempt ${context.attempt} of ${context.maxAttempts} for this pull request.`;

  const feedbackBlock = `
## What needs dealing with

${renderFeedback(context.feedback)}
`.trim();

  const protocol = `
## Protocol

**1. \`stage SETUP\`** — the branch is already checked out under
\`repos/${pullRequest.repo}\`. Confirm you are on \`${pullRequest.branch}\` and
that it is the branch the PR is from. If it is not, stop and \`ask\`.

**2. Understand before changing.** For a failing check, reproduce it: get the
log with \`gh run view --log-failed\` and run the failing command locally. A
fix for a failure you have not reproduced is a guess, and a guess pushed to
someone's open PR costs them a second review.

For a review comment, read the code the person is talking about and decide
whether they are right.

**3. \`stage CODING\`** — deal with each item:

- **They are right** → fix it properly. The smallest change that genuinely
  resolves what they raised, not the smallest change that makes the comment go
  away.
- **They are mistaken** → do not change the code. Reply explaining why, with
  the evidence (the line that already handles it, the test that covers it).
  Then report that item as \`dismissed\`. Disagreeing in writing is a
  legitimate outcome; silently ignoring a comment is not, and neither is
  changing working code because someone asked in passing.
- **You cannot tell what they mean** → reply asking, and report the item as
  \`dismissed\` with your question as the reply. Do not guess at an intent and
  build it.

**Never weaken a check to make it pass.** Deleting a failing test, loosening an
assertion, adding a skip, casting away a type error, widening a lint ignore —
all worse than the failure they hide, and all instantly obvious to the reviewer
whose comment prompted it.

**4. Stay inside the scope of the feedback.** Do not refactor code nobody
mentioned, do not fix unrelated things you notice, do not update dependencies.
A fix commit that also rewrites a neighbouring file makes the reviewer start
over. If you spot something real that is out of scope, say so in your report.

**5. \`stage GATE\`** — the machine gate runs after you and blocks on new
failures, so run the affected repo's tests, lint and typecheck yourself first.

**6. Commit and push.** One commit, imperative message, naming what feedback it
answers (e.g. \`fix(builder): guard a null tenant on the digest query\`).

- **Never force-push. Never rebase. Never amend an existing commit.** The
  reviewer's place in the diff, and any comment anchored to a line, are both
  destroyed by rewritten history — and they will not know why.
- Never push to master, and never run \`gh pr merge\`.

**7. Reply to each review comment in its own thread**, using the reply helper
so the person sees the answer where they asked rather than as a new top-level
comment. Say what you changed, or why you did not. One or two sentences.

**8. Report what happened to each item.** Write a JSON file and post it:

\`\`\`json
{
  "outcomes": [
    {"feedbackId": "…", "status": "addressed", "replyUrl": "https://github.com/…"},
    {"feedbackId": "…", "status": "dismissed", "replyUrl": "https://github.com/…"}
  ]
}
\`\`\`

\`\`\`bash
feedback() {
  curl -sS -X POST "${context.apiBaseUrl}/api/v1/builder/pipeline/runs/${context.runId}/feedback" \\
    -H "x-api-key: $ALLY_BE_API_KEY" \\
    -H 'Content-Type: application/json' -d @"$1" >/dev/null || true
}
\`\`\`

An item you leave out stays pending, and the next reconcile will send another
fix run at it — so report every item, including the ones you dismissed.

**9. \`stage REPORTING\`** — \`report\` with what you changed, what you pushed
back on and why, and anything out of scope you noticed. Then
\`complete '{"outcome":"done"}'\` exactly once.

## If you cannot finish

\`ask\` (batched, one pause) when an item needs a decision only a person can
make — a product question, a trade-off the PRD does not settle, a comment that
asks for something you think is wrong. Pausing is a success; guessing on
someone else's open pull request is not.

## The original PRD, for context

The PRD below is what this pull request was built from. Use it to judge whether
a review comment is asking for something in scope or something new — but the
feedback above is the work, not the PRD.
`.trim();

  return [header, feedbackBlock, protocol, renderPrd(context.prd)]
    .filter(Boolean)
    .join('\n\n---\n\n');
}
