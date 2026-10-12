import { BugChainLink } from './bug-case-chain.type';

/**
 * A fix that turned out wrong, by which link of the case chain broke — the
 * wrong-fix table, beside the miss table (OPP-0774).
 *
 * The miss table says why Bug Hunter did not find a bug first; this says
 * why a fix it made did not hold. Four things write it: the Verifier
 * refusing a PR for the wrong layer or a symptom still present, a sweep
 * re-finding a shipped bug (a regression), a person reverting a Bug Hunter
 * PR on master, and the post-release check finding the symptom back. Each
 * is a row with the broken link, so new failure classes show up as a link
 * that keeps breaking before anyone names them.
 *
 * Stored under `bug_findings.metadata.wrongFix` (latest), like the miss
 * record; aggregated by `BugHunterWrongFixService.summary` for Analytics.
 */
export const BUG_WRONG_FIX_SOURCES = [
  'verifier',
  'regression',
  'revert',
  'held_check',
] as const;
export type BugWrongFixSource = (typeof BUG_WRONG_FIX_SOURCES)[number];

export interface BugWrongFix {
  link: BugChainLink;
  source: BugWrongFixSource;
  /** One line a person can act on: what broke, in whose words. */
  reason: string;
  prUrl: string | null;
  /** The revert commit, for a revert; guards against recording it twice. */
  sha: string | null;
  /** Who reverted, when known. */
  by: string | null;
  at: string;
}

export function wrongFixOf(
  metadata: Record<string, any> | null | undefined,
): BugWrongFix | null {
  const w = metadata?.wrongFix;
  if (!w || typeof w !== 'object' || typeof w.link !== 'string') return null;
  return {
    link: w.link,
    source: BUG_WRONG_FIX_SOURCES.includes(w.source) ? w.source : 'verifier',
    reason: typeof w.reason === 'string' ? w.reason : '',
    prUrl: typeof w.prUrl === 'string' ? w.prUrl : null,
    sha: typeof w.sha === 'string' ? w.sha : null,
    by: typeof w.by === 'string' ? w.by : null,
    at: typeof w.at === 'string' ? w.at : '',
  };
}
