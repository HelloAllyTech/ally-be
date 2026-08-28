import { BugFinding } from '../entity/bug-finding.entity';
import {
  BUG_FIX_SESSION_JOB_TIMEOUT_MINUTES,
  BUG_FIX_SESSION_REPOS,
} from './bug-fix-session.constants';
import { repoCommands } from './bug-hunt-repos.constants';
import {
  BUG_HUNT_ESCALATION_ANSWER_TIMEOUT_MS,
  BUG_HUNT_ESCALATION_GUIDANCE,
  BUG_HUNT_ESCALATION_POLL_INTERVAL_MS,
  BUG_HUNT_MAX_FIX_ATTEMPTS,
} from './bug-hunter.constants';

export interface FixPromptContext {
  finding: BugFinding;
  repo: string;
  runId: string;
  apiBaseUrl: string;
}

/**
 * The whole fix-session protocol, as one prompt.
 *
 * ## Why this lives in ally-be and not in the workflow files
 *
 * A fix session runs on a GitHub-hosted runner inside whichever repo is being
 * fixed, so the obvious home for this text is that repo's own
 * `.github/workflows/bug-fix-session.yml`. That would mean five copies of a
 * protocol whose steps must not drift — exactly the "if you find a rule
 * written twice anywhere in this platform, that's a bug worth fixing" case
 * from ally-be/CLAUDE.md. Serving it from here instead leaves each repo's
 * workflow file a thin, genuinely identical runner: fetch prompt, run Claude
 * Code with it. It also makes the protocol unit-testable, and lets a change to
 * it take effect on the next dispatch rather than after five PRs.
 *
 * ## Merge policy
 *
 * The nightly sweep auto-merges at most three trivial fixes and leaves the
 * rest for review, because nobody asked for any of them. Here an admin asked
 * for this bug by name, so a green fix lands. Two carve-outs stay a reviewed
 * PR no matter who pressed the button: `touchesGuardedPath` (migrations,
 * auth/permission gating, payments, other security-sensitive services), and
 * `ally-mobile` unconditionally — this pipeline only runs Jest, so a green
 * suite here proves nothing about the native/on-device behaviour that
 * actually ships, and ally-mobile's CLAUDE.md gotchas (frozen released
 * builds, Indic glyphs silently missing on some ROMs, native changes needing
 * a rebuild rather than a reload to even test) are exactly the kind of
 * "unresolved, high-consequence, hard-to-verify-automatically" case that
 * belongs in front of a human rather than auto-merged. Either carve-out has a
 * second effect worth knowing: an unmerged fix never reaches MERGED, so the
 * "Release to production" button never appears for it, and it cannot reach
 * production down this path at all.
 */
export function buildFixSessionPrompt({
  finding,
  repo,
  runId,
  apiBaseUrl,
}: FixPromptContext): string {
  const commands = repoCommands(repo);
  if (!commands) {
    throw new Error(`No test/lint commands configured for repo "${repo}"`);
  }
  // The shared repo map covers everything Bug Hunter can SWEEP, which can be a
  // wider set than what it can fix — a repo with no `bug-fix-session.yml` at
  // all has nothing to dispatch this prompt into. Refuse here rather than emit
  // a protocol whose final steps cannot be carried out.
  if (!commands.fixable) {
    throw new Error(
      `Repo "${repo}" can be swept but not fixed from here — it has no fix-session workflow`,
    );
  }

  const authHeader = '-H "x-api-key: $ALLY_BE_API_KEY"';
  const findingUrl = `${apiBaseUrl}/api/v1/bug-hunter/pipeline/findings/${finding.id}`;
  const reportUrl = `${apiBaseUrl}/api/v1/bug-hunter/runs/${runId}/report`;
  const closeUrl = `${apiBaseUrl}/api/v1/bug-hunter/runs/${runId}/close`;

  const report = (stage: string, summary: string) =>
    `curl -sS -X POST "${reportUrl}" -H "Content-Type: application/json" ${authHeader} -d '${JSON.stringify(
      { repo, stage, summary, findingId: finding.id },
    )}'`;
  const patch = (body: Record<string, unknown>) =>
    `curl -sS -X PATCH "${findingUrl}" -H "Content-Type: application/json" ${authHeader} -d '${JSON.stringify(body)}'`;
  const plan = () =>
    `curl -sS -X POST "${findingUrl}/plan" -H "Content-Type: application/json" ${authHeader} -d '${JSON.stringify(
      {
        steps: [
          {
            repo: '<repo that must ship first>',
            summary: '<what changes there>',
          },
          { repo: '<next repo>', summary: '<what changes there>' },
        ],
      },
    )}'`;

  const escalationMinutes = Math.round(
    BUG_HUNT_ESCALATION_ANSWER_TIMEOUT_MS / 60_000,
  );
  const pollSeconds = Math.round(BUG_HUNT_ESCALATION_POLL_INTERVAL_MS / 1000);
  // ally-mobile never auto-merges, guarded path or not: this pipeline only
  // runs Jest, so a green suite here does not prove the native/on-device
  // behaviour that actually ships is fixed — see the class doc above.
  const mobileNeverMerges = repo === 'ally-mobile';
  const allowMerge = !finding.touchesGuardedPath && !mobileNeverMerges;
  const runMinutes = BUG_FIX_SESSION_JOB_TIMEOUT_MINUTES;

  // The three Node repos (ally-be, ally-web, ally-mobile) install a husky
  // pre-commit hook that re-runs lint and the full suite, so `git commit`
  // there routinely takes minutes. The Python two configure `pre-commit` but
  // CI never runs `pre-commit install`, so no hook fires and both branches
  // below are simply no-ops for them — hence "may fire" rather than "fires".
  // Whether skipping it is safe depends entirely on what happens to the commit
  // next.
  //
  // On the auto-merge path it is NOT safe. Step 9 lands the fix with `gh pr
  // merge --admin`, and master's protection has `enforce_admins: false` — so
  // the admin merge walks straight past the PR's own checks. The hook is
  // therefore the last place the suite ever runs against this diff before it
  // reaches master, and the only thing standing between a fix agent that
  // merely *believes* step 5 was green and a red master.
  //
  // On the PR-only path it is pure duplication: the PR's own CI run does
  // execute, a human reads it, and nothing merges until they do.
  const commitHookNote = allowMerge
    ? `\`git commit\` here may fire a pre-commit hook that re-runs lint and the whole test suite, which routinely takes several minutes. If it does, that is expected — it is NOT a hang, and it is NOT something to work around. Do not pass \`--no-verify\`: step 9 merges this with \`gh pr merge --admin\`, which bypasses the PR's own checks, so that hook is the last time the suite runs against your diff before it lands on master. Commit in the foreground and let it finish.`
    : `\`git commit\` here may fire a pre-commit hook that re-runs lint and the whole test suite, which routinely takes several minutes. You already ran both yourself at step 5, and this fix is not being merged by you — it stays an open PR whose own CI run and human reviewer are the real gate — so commit with \`git commit --no-verify\` and spend the time on the PR description instead.`;

  return [
    `You are fixing ONE confirmed bug in the "${repo}" repo, checked out at master in your current working directory, at an admin's explicit request. This bug is already known to be real — do not re-litigate whether it is worth fixing. Read this repo's CLAUDE.md before you change anything.`,
    ``,
    `Bug: ${finding.description}`,
    finding.file
      ? `File: ${finding.file}`
      : `File: not identified — locate it yourself.`,
    finding.evidence ? `Evidence: ${finding.evidence}` : '',
    finding.escalationAnswer
      ? `An admin already answered an open question about this bug on an earlier attempt: "${finding.escalationAnswer}". Use that answer; do not ask it again.`
      : '',
    ``,
    `HOW YOU ARE RUNNING — read this before you plan anything:`,
    `You are a single non-interactive process on a throwaway CI runner. The moment you end your turn the process exits and the runner is destroyed. There is no "later" for you: nothing re-invokes you, no background task ever notifies you, and any work not already pushed to GitHub is lost with the machine. So NEVER start a long command in the background and end your turn intending to pick it up when it finishes — that silently throws away the whole session. Run long commands in the FOREGROUND and wait for them, however many minutes they take; ${runMinutes} minutes is the real budget for everything below, and a single command is allowed to spend a large part of it. The two that usually take longest are the full suite at step 5 and the commit at step 8; both are meant to.`,
    ``,
    `Follow this protocol in order, with at most ${BUG_HUNT_MAX_FIX_ATTEMPTS} fix attempts:`,
    `0. Mark yourself as working on it: ${patch({ status: 'fixing' })}. Do this once, before anything else — an admin is watching this status.`,
    `0a. ${BUG_HUNT_ESCALATION_GUIDANCE} If you escalate, continue from step 6 below once the subagent reports back — it owns steps 1-5 for this finding, you own everything after.`,
    `1. Reproduce it. Write a new or updated regression test, in this repo's existing test-file convention, that fails because of this bug.`,
    `2. Run ONLY that new test against the current code and confirm it FAILS. If you cannot make it fail — the bug does not reproduce as described — stop here: run ${report('error', 'could not reproduce with a regression test')}, then ${patch({ status: 'dismissed' })}, and finish with outcome "dismissed". Say precisely what you tried and what you observed instead: an admin asked for this, so "could not reproduce" has to be actionable rather than a shrug.`,
    `2a. Check the blast radius before you change anything. You have ONLY this repo checked out. If a complete fix needs a change in another Ally repo too — a backend field the frontend has to render, a contract both sides share, a worker and the API that feeds it — do NOT fix your half and call it done: a merged half-fix is worse than no fix, because it looks finished and can be released on its own. Instead, hand back a plan and let Bug Hunter run it:`,
    `   ${plan()}`,
    `   Each step is one repo, in DEPENDENCY ORDER — whichever has to ship first comes first, so that everything already deployed keeps working without what follows it. Supported repos: ${BUG_FIX_SESSION_REPOS.join(', ')}. Then run ${report('escalated', 'this fix spans more than one repo — reported a plan')} and finish with outcome "escalated", WITHOUT committing anything. Bug Hunter takes it from there: it opens a session per step in your order, waits for each to merge before starting the next, and releases them in the same order. Do not try to do the other repos' work yourself.`,
    `3. Apply the minimal fix. Do not refactor, rename, or clean up anything beyond what this bug requires.`,
    `4. Re-run the new test and confirm it now PASSES. Then run ${report('test_written', 'regression test goes red before the fix and green after')}.`,
    `5. Run the full suite: "${commands.test}" and "${commands.lint}". Both must be green. If not, retry the fix (up to ${BUG_HUNT_MAX_FIX_ATTEMPTS} attempts in total). If it is still not green after that, run ${report('escalated', 'suite still red after the attempt cap')}, then ${patch({ status: 'failed' })}, and finish with outcome "failed". Never force a merge past a red suite and never keep retrying past the cap.`,
    `6. Check whether this fix makes a README, TESTING.md, DATA_SCHEMA.md or a CLAUDE.md "gotchas" section stale, and update it in the same change if so. Run ${report('doc_updated', 'updated stale docs alongside the fix')} naming the file if you touched one.`,
    `   If instead the root cause reveals undefined PRODUCT behaviour — a case nobody has decided the right answer for, not merely a code defect — do NOT invent an answer. Instead:`,
    `   a. PATCH the finding to status "needs_input" with an "escalationQuestion" field containing your real question in one or two sentences (same URL and headers as the other PATCH calls above).`,
    `   b. Run ${report('escalated', 'asked the admin an open product question')}.`,
    `   c. Poll for an answer every ${pollSeconds} seconds: curl -sS "${findingUrl}/answer" ${authHeader} — stop as soon as it returns {"answered":true,...}. Keep polling for up to ${escalationMinutes} minutes in total (chunk it across several waits if one tool call cannot span that long). Do not poll faster than that interval.`,
    `   d. If it is answered in time: use the answer, continue from step 3, and report stage "escalated" again noting what the answer changed.`,
    `   e. If it is not: report stage "escalated" noting that no answer arrived, and finish with outcome "escalated" WITHOUT applying a fix. Leave the status exactly as step (a) set it. The admin can answer at any time and start a fresh session, which will read the stored answer and not ask again.`,
    `7. Never touch migrations, auth/permission gating, payment or financial code, or other security-sensitive services as an incidental "while I am in here" change — only the diff this bug requires.`,
    `8. Commit, push a branch, and open a PR with "gh pr create" whose description states the bug, the evidence, the fix, and the regression test that proves it. ${commitHookNote} Run ${report('pr_opened', 'opened a PR with the fix and its regression test')}, then PATCH the finding to status "pr_opened" with the PR URL in a "prUrl" field.`,
    allowMerge
      ? `9. Merge it. An admin explicitly asked for this fix, so a green fix lands rather than queueing: run "gh pr merge --admin", then ${report('merged', 'merged the fix to master')}, then ${patch({ status: 'merged' })}, and finish with outcome "merged". Merge ONLY if step 5 was fully green AND your diff is genuinely limited to this bug — if it turned out to need a wider change than the bug described, leave the PR open, finish with outcome "pr_opened", and say so. Do NOT tag a release or deploy anything: promoting this to production is a separate decision an admin makes in the Bug Hunter tab.`
      : mobileNeverMerges
        ? `9. Do NOT merge. ally-mobile fixes always stay a reviewed PR: this pipeline only runs Jest, which cannot prove a native/on-device fix actually works, and a released mobile build is a frozen contract real users stay on for a long time. Leave the PR open and finish with outcome "pr_opened".`
        : `9. Do NOT merge. This fix touches a guarded path (migrations, auth/permission gating, payments, or another security-sensitive service), which stays a reviewed PR regardless of who asked for it. Leave the PR open and finish with outcome "pr_opened", naming in your summary which guarded area it touches so the reviewer knows where to look.`,
    `10. Finally, close the run: curl -sS -X POST "${closeUrl}" -H "Content-Type: application/json" ${authHeader} -d '{"status":"completed","foundCount":1,"autoMergedCount":<1 if you merged else 0>,"prOpenedCount":<1 if you left a PR open or escalated else 0>,"dismissedCount":<1 if you dismissed or failed else 0>}'. Do this exactly once, whatever the outcome — a run left open looks to an admin like a session still working.`,
    ``,
    `Report progress throughout with POST ${reportUrl} (JSON body {repo, stage, summary, payload, findingId}, header ${authHeader}). Valid stages: fix_attempt, test_written, doc_updated, pr_opened, merged, escalated, error.`,
    ``,
    `Before you end your turn the finding must be OUT of "fixing" — one of pr_opened, merged, dismissed, failed or needs_input, whichever step you reached — and the run must be closed by step 10. The workflow re-reads the finding the moment you exit and fails the job if it is still "fixing", so stopping mid-protocol is not a quiet outcome: it is a red run and an admin asking why. If you genuinely cannot finish, say so through step 5's or step 6's escalation path rather than simply stopping.`,
  ]
    .filter(Boolean)
    .join('\n');
}
