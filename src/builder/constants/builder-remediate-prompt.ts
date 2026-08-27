import { BuilderPrdDocument } from '../type/builder-prd.type';
import { BuilderRepoDefinition } from './builder-repos.constants';
import { buildPromptHeader, renderPrd } from './builder-build-prompt';

/**
 * The remediation pass: the **coder re-invoked** with what the machine gate
 * and the fresh-context reviewer found.
 *
 * This is the prompt the old loop was missing. It used to re-run the
 * *verifier* on a failing verdict, which meant round two reviewed byte-
 * identical code and every second round was a foregone conclusion. The build
 * prompt promised "address them and re-run the affected tests" to an agent
 * whose process had already exited. Fixing objections requires an agent with
 * edit tools, so that is what this invokes.
 *
 * Deliberately not a re-plan: the plan stands, the diff stands, and the job
 * is the delta. A remediation round that starts over would throw away work the
 * gate has already accepted.
 */

export interface GateFailure {
  repo: string;
  /** test | lint | typecheck */
  kind: string;
  command: string;
  /** Failures this change introduced — the ones that block. */
  newFailures: string[];
  /** Already failing before the change; reported, not blamed on this run. */
  preExistingFailures: string[];
  outputTail?: string | null;
}

export interface VerifierObjection {
  severity?: string;
  repo?: string;
  file?: string;
  summary?: string;
  detail?: string;
}

export interface RemediatePromptContext {
  sessionId: string;
  runId: string;
  branchSlug: string;
  prd: BuilderPrdDocument;
  repos: BuilderRepoDefinition[];
  apiBaseUrl: string;
  /** Which remediation attempt this is (2 = first remediation). */
  round: number;
  maxRounds: number;
  gateFailures: GateFailure[];
  objections: VerifierObjection[];
  /** The plan the original coding pass followed. */
  planMd?: string | null;
}

const renderGate = (failures: GateFailure[]): string =>
  failures
    .map((failure) => {
      const newFailures = failure.newFailures.length
        ? failure.newFailures.map((name) => `  - ${name}`).join('\n')
        : '  - (the command failed without naming individual cases)';
      const preExisting = failure.preExistingFailures.length
        ? `\n  Already failing before this change — **do not fix these here**, ` +
          `mention them in your report instead:\n${failure.preExistingFailures
            .map((name) => `  - ${name}`)
            .join('\n')}`
        : '';
      const tail = failure.outputTail
        ? `\n\n  \`\`\`\n${failure.outputTail}\n  \`\`\``
        : '';
      return `- **${failure.repo} ${failure.kind}** (\`${failure.command}\`) failed on:\n${newFailures}${preExisting}${tail}`;
    })
    .join('\n\n');

const renderObjections = (objections: VerifierObjection[]): string =>
  objections
    .map((objection, index) => {
      const where = [objection.repo, objection.file]
        .filter(Boolean)
        .join(' · ');
      return `**${index + 1}. [${objection.severity ?? 'concern'}] ${
        objection.summary ?? '(no summary given)'
      }**${where ? `\n${where}` : ''}${
        objection.detail ? `\n\n${objection.detail}` : ''
      }`;
    })
    .join('\n\n');

export function buildRemediatePrompt(context: RemediatePromptContext): string {
  const attemptsLeft = Math.max(0, context.maxRounds - context.round);

  const header = `${buildPromptHeader({
    sessionId: context.sessionId,
    runId: context.runId,
    branchSlug: context.branchSlug,
    apiBaseUrl: context.apiBaseUrl,
    repos: context.repos,
    role: 'coding agent',
  })}

You already implemented the PRD below on the branches in \`repos/\`. Checks
then ran over your work and found the problems listed here. Fix them.

This is attempt ${context.round} of ${context.maxRounds}. ${
    attemptsLeft > 0
      ? `${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remain after this one.`
      : 'This is the last attempt: if the checks still fail after it, the run ends with no pull request opened.'
  }

No pull request exists yet and none will until the gate and the reviewer are
both satisfied — so nothing here is public, and there is no rush to paper over
a problem you have not understood.`;

  const gateBlock = context.gateFailures.length
    ? `
## The test gate failed

These ran on the machine, not on anybody's word for it:

${renderGate(context.gateFailures)}
`.trim()
    : '';

  const objectionsBlock = context.objections.length
    ? `
## The reviewer's objections

A reviewer with a fresh context read your diff against the PRD. It has no
stake in the approach being right, which is exactly why it is worth reading
carefully rather than arguing with.

${renderObjections(context.objections)}
`.trim()
    : '';

  const protocol = `
## What to do

**1. \`stage REMEDIATING\`.** Then read each item above and decide, per item,
whether it is right.

**2. Fix what is right.** Smallest change that genuinely resolves the item,
not the smallest change that makes the symptom go away. A blocking objection
about a caller that now breaks is fixed by handling the case, not by narrowing
the test that caught it.

**3. Push back on what is wrong — in writing.** If an objection is mistaken,
say so explicitly in your summary with the evidence (the line that already
handles the case, the test that covers it). A reviewer can be wrong; silently
ignoring it cannot be told apart from missing it, and the next round will raise
it again.

**4. Never make a check pass by weakening it.** Deleting a failing test,
loosening an assertion, adding a skip, casting away a type error or widening a
lint ignore are all worse than the failure. If a test is genuinely wrong,
change it and say in one line why the old assertion was incorrect.

**5. Re-run what you touched.** The gate runs again after you finish, but a
failure you could have seen here costs another whole attempt.

**6. Keep the todo list honest** with \`todo\`, and post a short summary of
what you changed and what you rejected with \`note text "…"\`.

**7. Stop there.** Commit on each repo you changed. Do not push, do not open a
PR, do not call \`complete\` — the gate, the reviewer and the finalise phase
run after you.

If an item cannot be fixed without a decision only a person can make, \`ask\`
(batched, one pause) rather than guessing.
`.trim();

  const planBlock = context.planMd
    ? `
## The plan this run followed

${context.planMd}
`.trim()
    : '';

  return [
    header,
    gateBlock,
    objectionsBlock,
    protocol,
    planBlock,
    renderPrd(context.prd),
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');
}
