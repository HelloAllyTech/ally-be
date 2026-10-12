/**
 * The Verifier's judgement on a fix — OPP-0779.
 *
 * A fix session used to verify its own work and, where policy allowed, merge
 * it. On 2026-10-02 a fix that wrote 385 blank translations per language
 * passed its own checks and merged itself; nobody independent had read it.
 * From now on a fix stops at "PR opened". A separate run, on a different
 * vendor's model, checks out the PR and works through this checklist. Bug
 * Hunter merges only on a pass, and only where policy already allowed a
 * self-merge.
 *
 * The verdict word is not trusted: `pass` is COMPUTED from the checks here.
 * A verifier that says "pass" with a failed required check has contradicted
 * itself, and the checks win.
 */
export const BUG_FIX_VERDICT_CHECKS = [
  /** The PR's regression test, run against the base commit, fails. */
  'repro_at_base_fails',
  /** The same test, run against the PR head, passes. */
  'repro_at_head_passes',
  /** The repo's own test, lint and type commands at head; pre-existing failures compared against base, not excused by hand. */
  'suite',
  /** Every hunk is required by the brief, or named as scope creep. Data, locale and generated files are counted, not skimmed. */
  'diff_vs_brief',
  /** For data, locale, seed or generated files: counts before and after (keys, rows, blank values). */
  'data_file_counts',
  /** Callers of every changed exported symbol were read; behaviour at the boundaries the finding names. */
  'blast_radius',
  /** Frontend: the affected route loaded and looked at. Often skipped in CI, and says so. */
  'what_user_sees',
  /** The diff against the fixer's study: same files, the mechanism the codebase already uses, a sender for anything read from a request. Skipped only when no study exists. */
  'study_followed',
  /** Server-computed (OPP-0759): the PR touches a file a person must merge — Bug Hunter's own files, migrations, locales, seeds, snapshots, lockfiles, a stray pr-body.md. */
  'forbidden_files',
] as const;
export type BugFixVerdictCheckName = (typeof BUG_FIX_VERDICT_CHECKS)[number];

/** Checks that must be present and ok for a pass; the rest may be skipped with a reason. */
export const BUG_FIX_VERDICT_REQUIRED_CHECKS: BugFixVerdictCheckName[] = [
  'repro_at_base_fails',
  'repro_at_head_passes',
  'suite',
  'diff_vs_brief',
];

export interface BugFixVerdictCheck {
  name: BugFixVerdictCheckName;
  /** True when the check passed. False when it failed. Null when skipped, with `skipped` saying why. */
  ok: boolean | null;
  /** The command, count, screenshot path or assertion that backs the result. Never "looks fine". */
  evidence: string | null;
  skipped: string | null;
}

export interface BugFixVerdict {
  verdict: 'pass' | 'fail';
  /** 0–1: how sure the verifier is of its own verdict. */
  confidence: number | null;
  checks: BugFixVerdictCheck[];
  /** True when the diff does more than the brief asked. A pass is impossible with this set. */
  scopeExceeded: boolean;
  /** The sentence that would have to be false for this verdict to be wrong. */
  wouldBeWrongIf: string | null;
  /** One or two sentences a reviewer reads first. */
  summary: string | null;
  /** Which engine and model judged, as the run reported them. */
  by: { engine: string | null; model: string | null };
  prUrl: string | null;
  /** The PR head this verdict is about; a later push invalidates it. */
  prHeadSha: string | null;
  runId: string | null;
  at: string;
}

const str = (v: unknown, max = 600): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/**
 * Validate a verifier's report into a verdict, or return null when it is not
 * usable at all (no checks array). Unknown check names are dropped; a
 * required check that is missing or skipped counts as failed, because the
 * verifier was told it must run it.
 */
export function toBugFixVerdict(
  parsed: Record<string, unknown> | null | undefined,
  context: {
    by: { engine: string | null; model: string | null };
    prUrl: string | null;
    prHeadSha: string | null;
    runId: string | null;
    now?: Date;
  },
): BugFixVerdict | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const rawChecks = Array.isArray(parsed.checks) ? parsed.checks : null;
  if (!rawChecks) return null;

  const checks: BugFixVerdictCheck[] = [];
  for (const raw of rawChecks) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    if (!BUG_FIX_VERDICT_CHECKS.includes(c.name as never)) continue;
    const name = c.name as BugFixVerdictCheckName;
    if (checks.some((x) => x.name === name)) continue;
    const skipped = str(c.skipped, 300);
    const ok = skipped
      ? null
      : c.ok === true
        ? true
        : c.ok === false
          ? false
          : null;
    checks.push({ name, ok, evidence: str(c.evidence), skipped });
  }

  const scopeExceeded = parsed.scopeExceeded === true;
  const requiredOk = BUG_FIX_VERDICT_REQUIRED_CHECKS.every(
    (name) => checks.find((c) => c.name === name)?.ok === true,
  );
  const anyFailed = checks.some((c) => c.ok === false);
  const verdict: BugFixVerdict['verdict'] =
    requiredOk && !anyFailed && !scopeExceeded ? 'pass' : 'fail';

  const confidence =
    typeof parsed.confidence === 'number' &&
    parsed.confidence >= 0 &&
    parsed.confidence <= 1
      ? parsed.confidence
      : null;

  return {
    verdict,
    confidence,
    checks,
    scopeExceeded,
    wouldBeWrongIf: str(parsed.wouldBeWrongIf),
    summary: str(parsed.summary),
    by: context.by,
    prUrl: context.prUrl,
    prHeadSha: context.prHeadSha,
    runId: context.runId,
    at: (context.now ?? new Date()).toISOString(),
  };
}

/**
 * Adds checks the server computed itself to a verifier's report and
 * recomputes the verdict (OPP-0759). A deterministic rule the model cannot
 * talk itself out of: a failed server check fails the fix.
 */
export function withServerChecks(
  verdict: BugFixVerdict,
  extra: BugFixVerdictCheck[],
): BugFixVerdict {
  if (!extra.length) return verdict;
  const checks = [
    ...verdict.checks.filter((c) => !extra.some((e) => e.name === c.name)),
    ...extra,
  ];
  const requiredOk = BUG_FIX_VERDICT_REQUIRED_CHECKS.every(
    (name) => checks.find((c) => c.name === name)?.ok === true,
  );
  const anyFailed = checks.some((c) => c.ok === false);
  return {
    ...verdict,
    checks,
    verdict:
      requiredOk && !anyFailed && !verdict.scopeExceeded ? 'pass' : 'fail',
  };
}

/** The failures a reviewer or a retry needs, one line each. */
export function namedFailures(verdict: BugFixVerdict): string[] {
  const out: string[] = [];
  for (const name of BUG_FIX_VERDICT_REQUIRED_CHECKS) {
    const c = verdict.checks.find((x) => x.name === name);
    if (!c) out.push(`${name}: not run`);
    else if (c.skipped) out.push(`${name}: skipped (${c.skipped})`);
  }
  for (const c of verdict.checks) {
    if (c.ok === false)
      out.push(`${c.name}: ${c.evidence ?? 'failed, no evidence given'}`);
  }
  if (verdict.scopeExceeded)
    out.push('scope: the diff does more than the brief asked');
  return out;
}

/** The latest verdict for a PR head, or for the PR when no head is known. */
export function latestVerdictFor(
  verdicts: BugFixVerdict[] | null | undefined,
  prUrl: string | null,
  prHeadSha?: string | null,
): BugFixVerdict | null {
  if (!Array.isArray(verdicts) || !verdicts.length) return null;
  const matching = verdicts.filter(
    (v) =>
      (!prUrl || !v.prUrl || v.prUrl === prUrl) &&
      (!prHeadSha || !v.prHeadSha || v.prHeadSha === prHeadSha),
  );
  if (!matching.length) return null;
  return matching.sort((a, b) => b.at.localeCompare(a.at))[0];
}
