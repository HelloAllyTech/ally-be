import {
  BugFaultLocation,
  faultLocationOf,
} from '../type/bug-finding-verdict.type';
import { BUG_FIX_SESSION_REPOS } from './bug-fix-session.constants';

/**
 * Data repairs as pull requests.
 *
 * Until 2026-10-13 a located data fault went to a person as a notification
 * and nothing else: the code was right, a row was wrong, and no diff could
 * fix a row. That left the person to write the backfill by hand — the
 * missing translations for 188 simulations, say — which is exactly the work
 * a fix session is good at. Now a data fault in a repo Bug Hunter can fix
 * starts a REPAIR session there: it writes an idempotent backfill (a script,
 * an admin-only endpoint or a seed migration) with a dry run and tests, and
 * opens a PR that never merges itself. A person reviews it, merges it, and
 * runs it. Config faults still go to a person: a setting lives outside git.
 */
export function repairableDataFault(
  metadata: Record<string, any> | null | undefined,
): BugFaultLocation | null {
  const fault = faultLocationOf(metadata);
  return fault?.layer === 'data' &&
    fault.repo &&
    BUG_FIX_SESSION_REPOS.includes(fault.repo as never)
    ? fault
    : null;
}

/**
 * The repo a fix session belongs in: where the Verifier located the fault,
 * when it located one in a repo Bug Hunter can fix — a code fault or a
 * repairable data fault — and otherwise the finding's own repo. The symptom
 * shows where the user is; the fix goes where the fault is.
 */
export function repoForFault(
  metadata: Record<string, any> | null | undefined,
): string | null {
  const fault = faultLocationOf(metadata);
  if (!fault?.repo || !BUG_FIX_SESSION_REPOS.includes(fault.repo as never)) {
    return null;
  }
  return fault.layer === 'code' || fault.layer === 'data' ? fault.repo : null;
}

export const renderRepairBrief = (fault: BugFaultLocation): string[] => [
  `## This is a DATA REPAIR, not a code fix`,
  `The independent Verifier located the fault in production data${fault.repo ? ` owned by ${fault.repo}` : ''}: the code that serves the value is right, and rows are missing or wrong.${fault.evidence ? ` Its evidence: "${fault.evidence}".` : ''}${fault.repair ? ` The repair it named: "${fault.repair}".` : ''}`,
  `Your job is the repair a person will run, plus the code fix that stops the rows going missing again when the study finds one. Rules:`,
  `  - Write the repair as an idempotent backfill: an admin-only endpoint or a script under scripts/ that this repo's conventions already use (look for an existing one first and copy its shape). A migration only for fixed seed data. A second run must change nothing.`,
  `  - Default to a dry run that reports what it WOULD change (counts and ids), with an explicit flag to apply. Process items one by one so one failure does not stop the rest, and log what was filled.`,
  `  - Long work does not run inside one HTTP request: background it or batch it with a limit.`,
  `  - Never run it against production and never connect to a production database. Tests use the repo's test setup.`,
  `  - Write tests first: one that fails on master because the rows would stay missing, and one that proves a second run is a no-op.`,
  `  - Your study's "valueLivesIn" is "database". In the PR's change paragraph add a "How to run it" line: the exact call or command, dry run first.`,
  `  - This PR never merges itself, whatever the Verifier says: a person reviews it, merges it, and runs it. Leave it open and PATCH to pr_opened.`,
  ``,
];
