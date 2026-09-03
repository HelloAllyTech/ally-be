import { BugHunterMode } from '../enum/bug-finding.enum';
import { BUG_HUNT_SWEEP_JOB_TIMEOUT_MINUTES } from './bug-fix-session.constants';
import { repoCommands } from './bug-hunt-repos.constants';
import {
  BUG_HUNT_ESCALATION_GUIDANCE,
  BUG_HUNT_KNOWN_NON_BUG_EXCERPT,
  BUG_HUNT_LOW_CONFIDENCE_THRESHOLD,
  BUG_HUNT_MAX_AUTO_MERGES_PER_RUN,
  BUG_HUNT_MAX_FIX_ATTEMPTS,
  BUG_HUNT_VERIFIER_SUBAGENT,
} from './bug-hunter.constants';

/**
 * Trims one line of the known-non-bugs block.
 *
 * Every entry here is text somebody else wrote — a finder's title, a
 * reviewer's note — and the whole block is prepended to a protocol the agent
 * has to follow. Capping each line rather than the block keeps the newest
 * decisions from being the ones that get cut, and collapsing newlines stops a
 * multi-paragraph note from turning one bullet into a section.
 */
const clip = (value: string): string => {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > BUG_HUNT_KNOWN_NON_BUG_EXCERPT
    ? `${flat.slice(0, BUG_HUNT_KNOWN_NON_BUG_EXCERPT - 1)}…`
    : flat;
};

/** One bug the team has already judged not to be a bug — see `knownNonBugs`. */
export interface KnownNonBug {
  title: string;
  file?: string | null;
  symbol?: string | null;
  reason: string;
  note?: string | null;
}

export interface SweepPromptContext {
  repo: string;
  runId: string;
  apiBaseUrl: string;
  mode: BugHunterMode;
  /** Read the whole repo rather than only the last day's diff. Costs far more. */
  deep: boolean;
  /**
   * Findings this repo's reviewers already ruled were not bugs, newest first.
   *
   * The sweep had no memory at all before this: it re-read the same code every
   * night and re-filed the same rejected findings, so a reviewer's decision
   * lasted exactly one night. Dedupe now suppresses the duplicate row, but
   * suppression happens after the finding has been reasoned about and written
   * — this block is what stops the work being done in the first place, and is
   * the same shape `src/ux-signals` has always passed into its triage call.
   *
   * Only finder-error declines belong here (see
   * BUG_FINDING_FINDER_ERROR_REASONS): telling a sweep "you were wrong about
   * this" helps, whereas showing it real bugs the team chose not to fix would
   * teach it to stop reporting real bugs.
   */
  knownNonBugs?: KnownNonBug[];
}

/**
 * The whole repo-wide sweep protocol, as one prompt.
 *
 * ## Why this exists alongside `.claude/workflows/bug-hunt.mjs`
 *
 * The sweep has always been a Claude Code *Workflow* script — it uses the
 * `agent()`, `parallel()` and `budget` primitives, which only exist inside a
 * Claude Code session. That makes it excellent for an interactive or
 * locally-driven sweep and completely undispatchable from CI: a GitHub runner
 * has no way to execute it. Which is why, until now, nothing triggered a sweep
 * automatically — `BugHuntTrigger.SCHEDULED` was a valid enum value with no
 * producer anywhere in the platform.
 *
 * This prompt is the unattended executor: a GitHub Actions runner fetches it
 * and hands it to `claude -p`, exactly as `bug-fix-session.yml` already does
 * with `buildFixPrompt`. Two executors, deliberately:
 *
 *   - `bug-hunt.mjs` — interactive, deterministic fan-out, budget-aware.
 *   - this prompt — unattended, dispatchable, cron-able.
 *
 * The thing that must NOT be duplicated is what they know: the repo commands
 * (`bug-hunt-repos.constants.ts`), the merge cap and attempt limits
 * (`bug-hunter.constants.ts`), and the finder definitions below. `bug-hunt.mjs`
 * reads the commands from `GET pipeline/repo-commands` rather than carrying its
 * own copy, which is how the previously-drifted `REPO_COMMANDS` pair was
 * collapsed into one.
 *
 * ## Merge policy — deliberately stricter than a fix session's
 *
 * Nobody asked for any of these findings, so the sweep auto-merges at most
 * `BUG_HUNT_MAX_AUTO_MERGES_PER_RUN` genuinely trivial fixes and leaves
 * everything else as a PR for review. A fix session, by contrast, merges any
 * green fix — because there an admin asked for that bug by name. Guarded paths
 * never merge on either path, and neither does `ally-mobile`: this pipeline
 * only runs Jest, which cannot verify the native/on-device behaviour that
 * actually ships, so every ally-mobile fix — trivial or not — stays a PR for
 * a human to merge.
 */
export function buildSweepPrompt(ctx: SweepPromptContext): string {
  const { repo, runId, apiBaseUrl, mode, deep, knownNonBugs = [] } = ctx;

  const commands = repoCommands(repo);
  if (!commands) {
    // Same reasoning as buildFixPrompt: emitting a protocol whose verification
    // steps are undefined is worse than refusing, because the agent would
    // "finish" without ever having proven anything.
    throw new Error(
      `No test/lint commands configured for repo "${repo}" — refusing to build a sweep prompt that cannot verify anything.`,
    );
  }

  const auth = '-H "x-api-key: $ALLY_BE_API_KEY"';
  const base = `${apiBaseUrl}/api/v1/bug-hunter`;
  const findingsUrl = `${base}/runs/${runId}/findings`;
  const reportUrl = `${base}/runs/${runId}/report`;
  const closeUrl = `${base}/runs/${runId}/close`;

  // No per-stage report helper here, unlike buildFixPrompt: a sweep reports
  // many times across four phases, so the prompt gives the agent the one
  // parameterised curl up front and names the stage in prose thereafter.
  // Embedding a pre-baked command per mention would triple the prompt's length
  // for no added precision.

  // MANUAL stops verified findings at pending_approval and waits for a human;
  // AI carries straight on into Fix. Discovery is identical in both — a
  // comprehensive table is only useful if it keeps finding bugs regardless of
  // who is allowed to fix them.
  const gated = mode === BugHunterMode.MANUAL;
  // ally-mobile writes code and opens PRs like any other fixable repo, but
  // never merges — see the class doc's merge-policy note. The three protected
  // repos cannot merge either, for an entirely different reason: the bot has
  // push access and `master` wants a review, so `gh pr merge --admin` fails.
  // Both end in the same instruction, and the prompt says which applies so
  // the agent does not read a permissions wall as a policy it could argue
  // with.
  const neverMerges = repo === 'ally-mobile' || !commands.canBotMerge;
  const mergeBlockedByPermissions =
    repo !== 'ally-mobile' && !commands.canBotMerge;

  return [
    `You are running a repo-wide bug sweep on the "${repo}" repo, checked out at master in your current working directory. Read this repo's CLAUDE.md before you change anything. Bug Hunter is in ${mode.toUpperCase()} mode.`,
    ``,
    `HOW YOU ARE RUNNING — read this before you plan anything:`,
    `You are a single non-interactive process on a throwaway CI runner. The moment you end your turn the process exits and the runner is destroyed. There is no "later" for you: nothing re-invokes you, no background task ever notifies you, and any work not already pushed to GitHub or reported to Bug Hunter is lost with the machine. So NEVER start a long command in the background and end your turn intending to pick it up when it finishes — that silently throws away the rest of the sweep. Run long commands in the FOREGROUND and wait for them, however many minutes they take; ${BUG_HUNT_SWEEP_JOB_TIMEOUT_MINUTES} minutes is the real budget for everything below, and a single command is allowed to spend a large part of it. The full suite in Phase 1 and each commit in Phase 3 are the slowest, and both are meant to be — a commit here may fire a pre-commit hook that re-runs lint and the whole suite, which is expected and is NOT a hang.`,
    ``,
    `Work through these phases IN ORDER. Report progress as you go with:`,
    `  curl -sS -X POST "${reportUrl}" -H "Content-Type: application/json" ${auth} -d '{"repo":"${repo}","stage":"<stage>","summary":"<one line>"}'`,
    `Valid stages: finder_result, verify, fix_attempt, test_written, doc_updated, pr_opened, merged, escalated, error.`,
    ``,
    `## Phase 1 — Discover`,
    `Run these four finders. Do them in whatever order you like, but do ALL of them, and report a finder_result for each even when it found nothing — a clean finder is a result, not a gap.`,
    ``,
    `1. TEST/LINT. Run "${commands.test}" and "${commands.lint}". Any failing test or lint error is a CONFIRMED bug; no judgement call is needed to prove it. severity "high" for a failing test, "low" for lint. proven=true.`,
    deep
      ? `2. CODE REVIEW (deep). Read broadly across the codebase for correctness bugs a careful reviewer would flag. proven=false.`
      : `2. CODE REVIEW (diff-scoped). Read ONLY files changed by "git log --since='1 day ago'" — or the last 20 commits if that range is empty. Do not read the whole repo; this bounds the cost. proven=false.`,
    `3. PRODUCTION LOGS. curl -sS "${base}/pipeline/prod-logs?repo=${repo}" ${auth} — the last 24h of CloudWatch errors for this repo. A response of {"events":null} means this repo has no log group (the frontend repos): that is zero findings, not an error. Report only DISTINCT, RECURRING errors, never a one-off transient blip. proven=true.`,
    `4. REPORTED BUGS. curl -sS "${base}/pipeline/reported-bugs" ${auth} — human bug reports awaiting triage, platform-wide rather than repo-scoped. Take only items clearly about "${repo}"; skip anything about another repo or too vague to act on. proven=false. Pass the item's "reportedBugId" field, NOT its "id".`,
    ``,
    ...(knownNonBugs.length
      ? [
          ``,
          `### Already settled — do NOT file these again`,
          `Reviewers have looked at each of the following in "${repo}" and concluded it is not a bug. They are listed newest first. If your reading of the code leads you to one of them, that is a signal your reading is wrong, not that the reviewer was: move on and do not report it.`,
          ...knownNonBugs.map((entry) => {
            const where = [entry.file, entry.symbol]
              .filter(Boolean)
              .join(' · ');
            const note = entry.note?.trim();
            return (
              `  - ${clip(entry.title)}` +
              (where ? ` (${clip(where)})` : '') +
              ` — judged "${entry.reason}"` +
              (note ? `: ${clip(note)}` : '')
            );
          }),
          `If you are confident one of these IS in fact a real bug — because the code has changed since, or because you have evidence the reviewer did not — you may still report it, but say in the description that it was previously declined and what is different now. Bug Hunter will otherwise suppress it as a duplicate of that decision.`,
        ]
      : []),
    ``,
    `For every finding, record: file, symbol, description, evidence, severity, source, proven, touchesGuardedPath.`,
    `  - description has two parts, in order: (1) a short plain-language paragraph, written for a non-technical reader, naming what's going wrong and how it affects a user or their experience — say so plainly even when the impact is indirect or purely internal (e.g. a lint error affects no user directly, so say that); then (2) a blank line, then the technical detail (files, functions, root cause) for an engineer. The drawer renders this field with whitespace preserved, so the blank line is what actually separates the two paragraphs.`,
    `  - symbol is the function, class, route, component or endpoint the bug sits on. ALWAYS name one when the bug has a location — it is what stops the same bug opening a duplicate row when a later sweep words it differently. Omit it only when there genuinely is none (a log cluster spanning many handlers).`,
    `  - touchesGuardedPath=true for migrations, auth/permission gating, payments, or any other security-sensitive service. Be generous with this flag; it costs a review, and getting it wrong costs a production incident.`,
    `  - source is one of: test_failure, lint_error, code_review, production_log, reported_bug.`,
    ``,
    `Then persist them all in ONE call, dropping any duplicates you produced within this round:`,
    `  curl -sS -X POST "${findingsUrl}" -H "Content-Type: application/json" ${auth} -d '{"repo":"${repo}","findings":[...]}'`,
    `The response's "items" array comes back in the same order you sent, each with an "id" — use those ids in every later call about a finding. You do NOT need to dedupe against previous runs: the server matches each finding against still-open rows and touches the existing one instead of inserting, so a bug rediscovered tonight keeps its history.`,
    ``,
    `## Phase 2 — Verify`,
    `Findings with proven=true skip this phase entirely; they are already ground truth and spending effort re-arguing them is waste.`,
    ``,
    `For each UNPROVEN finding, get TWO INDEPENDENT verdicts by invoking the Task tool twice with subagent_type "${BUG_HUNT_VERIFIER_SUBAGENT}" — once per verdict, both about the same finding.`,
    `Do NOT judge these findings yourself. You wrote them (or a subagent you briefed did), and re-reading your own reasoning is not verification: last night this phase reported "I personally read the code for all 9 and confirmed 8" with no way for anyone to know whether that was good. A verifier that never saw your reasoning and starts from the code is the only thing that makes a confirmation mean something.`,
    `Give each verifier ONLY the finding's file, symbol, description and evidence — never your rationale, never the other verifier's verdict, and never how many findings survived so far. Everything you add is a nudge towards agreeing with you.`,
    `Each verifier returns a JSON object: {"refuted": true|false, "certainty": <0-1>, "reason": "<one or two sentences>"}. "certainty" is how sure that verifier is of its OWN verdict, not how severe the bug is.`,
    ``,
    `Then, per finding:`,
    `  - If EITHER verifier refutes it, dismiss it. Two independent readers and one says this is not a bug is enough: a false positive costs a reviewer their trust in the whole queue, while a missed bug costs one more night. PATCH it —`,
    `    curl -sS -X PATCH "${base}/pipeline/findings/<id>" -H "Content-Type: application/json" ${auth} -d '{"status":"dismissed","decisionReason":"<not_a_bug|duplicate|wrong_repo>","decisionNote":"<the refuting verifier's reason>","confidence":<the refuter's certainty>}'`,
    `    decisionReason is REQUIRED here and it is not paperwork: it is fed back into the next sweep as a known non-bug, and it is what the accuracy figure on the admin tab divides by. Pick "not_a_bug" when the code simply is not wrong, "wrong_repo" when the bug is real but lives in another Ally repo, "duplicate" when it is the same defect as another finding this run.`,
    `  - If BOTH accept it, it survives. PATCH the certainty onto it so a human can see how sure the verifiers were —`,
    `    curl -sS -X PATCH "${base}/pipeline/findings/<id>" -H "Content-Type: application/json" ${auth} -d '{"confidence":<the LOWER of the two certainties>,"verifierVotes":[{"refuted":false,"certainty":<n>,"reason":"..."},{"refuted":false,"certainty":<n>,"reason":"..."}]}'`,
    `    The LOWER, not the average: if one reader was unsure, the finding is unsure, and averaging is how an uncertain finding gets laundered into a confident one.`,
    `  - Report a verify stage per finding either way, saying what the verifiers concluded.`,
    ``,
    `Note which survivors came out below ${BUG_HUNT_LOW_CONFIDENCE_THRESHOLD}. Those are held for a human in Phase 3 even in AI mode — see the low-confidence rule there.`,
    ``,
    `## Phase 3 — Fix`,
    !commands.fixable
      ? `This repo cannot be fixed from here: it has no fix-session workflow and releases through App Store / Play Store builds, so there is nothing for a merged change to land into. Do NOT write code, open a branch, or open a PR. PATCH every surviving finding to {"status":"pending_approval"} so a human picks it up, and go straight to Phase 4. Recording the bug is the whole job on this repo, and it is a useful one.`
      : gated
        ? `Bug Hunter is in MANUAL mode, so you do NOT fix anything you found tonight. PATCH every surviving finding to {"status":"pending_approval"} and stop there — an admin decides which ones you may work on, and the next sweep picks up whatever they approved.`
        : `Bug Hunter is in AI mode, so surviving findings are yours to fix — EXCEPT any whose verifier confidence came out below ${BUG_HUNT_LOW_CONFIDENCE_THRESHOLD}. PATCH each of those to {"status":"pending_approval"} and leave it alone. Two readers who both accepted a finding but were unsure about it is precisely the case where a human should look before an agent writes code: the cost of being wrong is a bad diff on master, and the cost of waiting is one night.`,
    commands.fixable
      ? `Also fetch anything an admin approved on an earlier run — those are always yours to fix regardless of the current mode, because approval once given should not evaporate because the switch moved:`
      : '',
    commands.fixable
      ? `  curl -sS "${base}/pipeline/approved-findings?repo=${repo}" ${auth}`
      : '',
    ``,
    ...(commands.fixable
      ? [
          `For each finding you are fixing, in severity order (high first), at most ${BUG_HUNT_MAX_FIX_ATTEMPTS} attempts each:`,
          `  a. PATCH it to {"status":"fixing"}.`,
          `  a1. ${BUG_HUNT_ESCALATION_GUIDANCE} If you escalate, continue from step (e) below once the subagent reports back.`,
          `  b. Write a regression test that FAILS because of this bug. If you cannot make it fail, the bug does not reproduce: PATCH to {"status":"dismissed"}, report an error stage saying exactly what you tried and observed, and move on.`,
          `  c. Apply the MINIMAL fix. No refactoring, renaming or drive-by cleanup.`,
          `  d. Confirm the new test passes, then run the full "${commands.test}" and "${commands.lint}". Both must be green. If they are not after ${BUG_HUNT_MAX_FIX_ATTEMPTS} attempts, PATCH to {"status":"failed"}, report escalated, and move on. Never force past a red suite.`,
          `  e. If the fix needs a change in ANOTHER repo too, do not fix half of it — a merged half-fix is worse than no fix, because it looks finished and can be released on its own. POST an ordered plan to "${base}/pipeline/findings/<id>/plan" with one step per repo in dependency order, report escalated, and commit nothing for that finding.`,
          `  f. If the root cause turns out to be undefined PRODUCT behaviour rather than a code defect, do not invent an answer: PATCH to {"status":"needs_input"} with an "escalationQuestion", report escalated, and move on to the next finding. Unlike a fix session you do NOT wait for an answer here — a sweep has other work to do, and the next run will read whatever the admin replied.`,
          `  g. Commit, push a branch, open a PR with "gh pr create" describing the bug, the evidence, the fix and the test. PATCH to {"status":"pr_opened"} with "prUrl", and report pr_opened.`,
          ``,
          `### Merging — the sweep is deliberately stricter than an on-demand fix`,
          mergeBlockedByPermissions
            ? `Do not attempt to merge anything here, and do not treat that as a failure. "${repo}"'s master requires an approving review and your token has push access only, so "gh pr merge --admin" has no admin rights to bypass it with and will simply fail. Every fix you open stays a green PR; Bug Hunter shows each one to an admin as one click to merge. Leaving a green PR IS the finished outcome on this repo — do not run "gh pr merge" at all.`
            : neverMerges
              ? `Never merge here, however trivial the fix looks. This repo's pipeline only runs Jest, which cannot verify the native/on-device behaviour that actually ships, and a released mobile build is a frozen contract real users stay on for a long time. Every fix you open in ally-mobile stays a PR for a human to merge — do not run "gh pr merge" at all.`
              : `Nobody asked for these fixes, so most of them stay PRs. You may merge at most ${BUG_HUNT_MAX_AUTO_MERGES_PER_RUN} of them in this entire run, and ONLY ones that are all of:`,
          neverMerges ? '' : `  - fully green on both gates,`,
          neverMerges
            ? ''
            : `  - touchesGuardedPath=false — never a migration, auth/permission, payment or other security-sensitive change, whatever the diff size,`,
          neverMerges
            ? ''
            : `  - genuinely trivial: a lint/type-only fix, or a single-file change plus its test.`,
          neverMerges
            ? ''
            : `Count them as you go and stop at the cap even if more would qualify. Do not merge something borderline just because you were told you could — a PR left for review costs a reviewer five minutes, and a bad merge costs far more. To merge: wait for the PR's own checks with "gh pr checks --watch --fail-fast", then "gh pr merge --squash" — never "--admin", which would bypass the very run that is your second opinion here. If the checks go red, leave the PR open and report an error stage instead. On a green merge, PATCH to {"status":"merged"} and report merged.`,
          `Never tag a release and never deploy. Promoting anything to production is a separate decision an admin makes in the Bug Hunter tab.`,
          ``,
        ]
      : []),
    `## Phase 4 — Close`,
    `Exactly once, whatever happened, including if you found nothing at all:`,
    `  curl -sS -X POST "${closeUrl}" -H "Content-Type: application/json" ${auth} -d '{"status":"completed","foundCount":<n>,"autoMergedCount":<n>,"prOpenedCount":<n>,"dismissedCount":<n>}'`,
    `A run left open looks to an admin like a sweep still working. If you hit something that stopped you entirely, close with {"status":"failed",...} instead and report an error stage explaining what. The workflow re-reads this run the moment you exit and fails the job if it is still open, so stopping without closing is not a quiet outcome — it is a red run and an admin asking why.`,
    ``,
    `Finally: if a fix made a README, TESTING.md, DATA_SCHEMA.md or a CLAUDE.md "gotchas" section stale, update it in the same PR and report doc_updated naming the file.`,
  ]
    .filter(Boolean)
    .join('\n');
}
