import { BugHuntDecision } from '../entity/bug-hunt-decision.entity';
import { BugCaseFile, BugCaseVerdict } from './bug-case-file';
import { clipDossierText } from './bug-fix-dossier';

/** The two sections only the Fixer can write. The brief tells it to replace these markers. */
export const PR_BODY_SLOT_CHANGE = '<!-- fixer: the change, in words -->';
export const PR_BODY_SLOT_UNTOUCHED =
  '<!-- fixer: left untouched on purpose -->';

/**
 * A fix PR's description, rendered from the case file (OPP-0784).
 *
 * A reviewer used to reconstruct what had been checked from a description
 * the fix session wrote in its own words. The case file already holds the
 * record — the bug as filed, who verified it and how, every orchestration
 * decision, what the case has cost — so the server renders that part and
 * the Fixer adds only what it alone knows: the change in words, and what it
 * left alone on purpose. The drawer reads the same case file, so the PR and
 * the drawer say the same thing.
 *
 * Markdown for GitHub. Everything quoted from the case is clipped, since a
 * PR body is read on a phone as often as on a monitor.
 */
export function renderPrBody(
  caseFile: BugCaseFile,
  opts: { repo: string; adminUrl?: string | null },
): string {
  const f = caseFile.finding;
  const lines: string[] = [];

  lines.push(
    `## The bug`,
    clipDossierText(f.description, 900),
    ``,
    ...[
      f.file
        ? `- **File:** \`${f.file}\`${f.symbol ? ` · \`${f.symbol}\`` : ''}`
        : null,
      `- **Found by:** ${sourceWord(f.source)}${f.severity ? ` · severity ${f.severity}` : ''}`,
      caseFile.reporter
        ? `- **Reported by:** ${caseFile.reporter.source === 'consumer' ? 'a consumer, through the in-app form' : 'a staff member'} on ${day(caseFile.reporter.reportedAt)}`
        : null,
      f.touchesGuardedPath
        ? `- **Guarded path:** this change touches migrations, auth, payments or another security-sensitive area — a person merges it.`
        : null,
    ].filter((l): l is string => Boolean(l)),
  );

  lines.push(``, `## Verified before the fix`);
  const independent = latest(
    caseFile.verdicts,
    'finding',
    (v) => v.by !== null,
  );
  const sweep = caseFile.verdicts.filter(
    (v) => v.kind === 'finding' && v.by === null,
  );
  if (independent) {
    lines.push(
      `An independent Verifier on ${independent.by} **${independent.verdict}** this bug${independent.confidence != null ? ` (${pct(independent.confidence)} sure)` : ''}:`,
      ``,
      `> ${clipDossierText(independent.reason ?? 'no reproduction text recorded', 600)}`,
    );
  } else if (f.proven) {
    lines.push(
      `Proven by tool output (${sourceWord(f.source)}); no judgement was needed.`,
    );
  } else if (sweep.length) {
    const accepted = sweep.filter((v) => v.verdict !== 'refuted').length;
    lines.push(
      `${accepted} of ${sweep.length} sweep verifiers accepted this reading of the code${caseFile.verdicts.some((v) => v.confidence != null) ? ` (least sure: ${pct(Math.min(...sweep.map((v) => v.confidence ?? 1)))})` : ''}.`,
    );
  } else {
    lines.push(
      `Not independently verified before this fix; the regression test in this PR is the proof.`,
    );
  }

  lines.push(
    ``,
    `## The change, in words`,
    PR_BODY_SLOT_CHANGE,
    ``,
    `## Left untouched on purpose`,
    PR_BODY_SLOT_UNTOUCHED,
  );

  if (caseFile.decisions.length) {
    lines.push(``, `## What Bug Hunter decided along the way`);
    for (const d of [...caseFile.decisions].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )) {
      lines.push(`- ${decisionLine(d)}`);
    }
  }

  const b = caseFile.budget;
  lines.push(
    ``,
    `## Cost so far`,
    `${b.used.sessions} of ${b.caps.sessions} sessions · ${b.used.attempts} of ${b.caps.attempts} attempts · $${b.used.usd.toFixed(2)} of $${b.caps.usd} · ${Math.round(b.used.minutes)} of ${b.caps.minutes} minutes${b.exhausted ? ` · **${b.exhausted} budget spent**` : ''}`,
  );

  lines.push(
    ``,
    `---`,
    `_Bug Hunter case \`${f.id}\` on ${opts.repo}.${opts.adminUrl ? ` [Open in the admin](${opts.adminUrl}).` : ''} A separate Verifier run reads this PR before it can merge and posts its verdict below; nothing merges without a pass._`,
  );

  return lines.join('\n');
}

function latest(
  verdicts: BugCaseVerdict[],
  kind: BugCaseVerdict['kind'],
  where: (v: BugCaseVerdict) => boolean = () => true,
): BugCaseVerdict | null {
  const mine = verdicts.filter(
    (v) => v.kind === kind && where(v) && v.verdict !== 'unavailable',
  );
  if (!mine.length) return null;
  return mine.reduce((a, b) =>
    (b.at?.getTime() ?? 0) > (a.at?.getTime() ?? 0) ? b : a,
  );
}

function decisionLine(d: BugHuntDecision): string {
  const pick = pickWord(d.pick);
  const shadow =
    d.shadowPick !== null &&
    d.shadowPick !== undefined &&
    pickWord(d.shadowPick) !== pick
      ? ` (the ${d.shadowOwner ?? 'other owner'} would have: ${pickWord(d.shadowPick)})`
      : '';
  const veto = (d.inputs as { veto?: { by: string; reason: string } } | null)
    ?.veto;
  return `**${d.point}** ${pick} — by the ${d.owner}${shadow}${veto ? `; veto (${veto.by}): ${clipDossierText(veto.reason, 160)}` : d.reason && d.owner === 'model' ? `; ${clipDossierText(d.reason, 160)}` : ''}`;
}

function pickWord(pick: unknown): string {
  if (Array.isArray(pick)) return pick.map(String).join(', ') || '—';
  if (pick && typeof pick === 'object') {
    const p = pick as Record<string, unknown>;
    if (typeof p.model === 'string')
      return `${p.engine ?? ''}${p.engine ? ' ' : ''}${p.model}`;
    return JSON.stringify(pick);
  }
  return pick === null || pick === undefined ? '—' : String(pick);
}

const sourceWord = (source: string): string => source.replace(/_/g, ' ');
const pct = (n: number): string => `${Math.round(n * 100)}%`;
const day = (d: Date | null): string =>
  d ? new Date(d).toISOString().slice(0, 10) : 'an unknown date';
