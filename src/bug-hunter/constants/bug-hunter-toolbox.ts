import { BUG_FIX_SESSION_REPOS } from './bug-fix-session.constants';
import {
  renderPipelineProbes,
  renderProductionProbes,
} from './bug-hunter-probes.constants';

export interface ToolboxContext {
  apiBaseUrl: string;
  repo: string;
  runId: string;
  authHeader: string;
  findingId?: string;
}

/** Where the runner puts the other Ally repos, read-only. Kept in step with the workflows' sibling checkout. */
export const BUG_HUNTER_SIBLINGS_DIR = '/tmp/siblings';

/**
 * Every tool a Bug Hunter run has for LOCATING a fault, in one section every
 * protocol renders the same way: the running system as a browser sees it,
 * live data and logs through ally-be, the other repos' source, and what
 * Bug Hunter already knows. Written after a fix session that saw one repo
 * and nothing running "fixed" a backend data fault in the frontend.
 */
export function renderToolbox({
  apiBaseUrl,
  repo,
  runId,
  authHeader,
  findingId,
}: ToolboxContext): string[] {
  const base = `${apiBaseUrl.replace(/\/$/, '')}/api/v1/bug-hunter/pipeline`;
  const others = BUG_FIX_SESSION_REPOS.filter((r) => r !== repo);
  return [
    `## Your tools for locating the fault`,
    `Use them before you decide which layer is broken. A claim about data or production carries the call you made and what it returned; "probably missing" is not evidence.`,
    `1. Production as a browser sees it — public GETs, no key:`,
    ...renderProductionProbes(apiBaseUrl),
    `2. Production data and logs through ally-be — fixed read-only questions, recorded against this run:`,
    ...renderPipelineProbes(apiBaseUrl, runId, authHeader),
    `3. The other Ally repos' source, read-only, at ${BUG_HUNTER_SIBLINGS_DIR}/<repo> (${others.join(', ')}). Read them with shell tools: ls, grep -rn, sed -n. Follow a value across the boundary — the endpoint a client calls and the service behind it. Never edit them; a change another repo needs goes in your cross-repo plan. If the directory is empty the runner could not fetch them: say so rather than guess what they contain.`,
    `4. What Bug Hunter already knows, beyond what this prompt shows:`,
    `  - Feature cards (how a feature works across repos): curl -sS "${base}/feature-maps?q=<the feature in a few words>&runId=${runId}" ${authHeader}`,
    findingId
      ? `  - Resolved bugs like this one and where their fault was: curl -sS "${base}/precedents?findingId=${findingId}&runId=${runId}" ${authHeader}`
      : `  - Resolved bugs like a finding and where their fault was: curl -sS "${base}/precedents?findingId=<finding id>&runId=${runId}" ${authHeader}`,
    `  - Playbooks for a class of bug: curl -sS "${base}/playbooks?q=<the bug in one line>" ${authHeader}`,
    ``,
  ];
}
