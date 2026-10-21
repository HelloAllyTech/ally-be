import { latestVerdictFor } from './bug-fix-verdict.type';
import { readBugFixStudy } from './bug-fix-study.type';
import { faultLocationOf, isDataFault } from './bug-finding-verdict.type';
import { BugFindingSource, BugFindingStatus } from '../enum/bug-finding.enum';

/**
 * The case chain: a fix is a chain of evidence from the symptom somebody
 * saw to the change that removed it, and a missing link fails it.
 *
 * ## Why one rule and not one safeguard per mistake
 *
 * The weekend of 2026-10-10 produced two wrong fixes: translations "fixed"
 * in the frontend when rows were missing in production data, and a fix whose
 * regression test proved a synthetic key rather than the reporter's steps.
 * Listing the ways a fix can be wrong — wrong layer, wrong side of a
 * contract, wrong environment, symptom chasing, an invented mechanism, a
 * parallel mechanism, collateral change, one instance of a pattern,
 * papering over a test, verification that passes for the wrong reason, a
 * loop nobody closes — every one is the same thing: a link in this chain
 * that nobody checked. So the pipeline checks the chain, and the classes
 * fall out of which link broke.
 *
 * Derived, never stored: every link reads what the stages already record on
 * the finding (the report's steps, the Verifier's reproduction and located
 * fault, the study, the PR, the fix verdict, the release and what came after).
 * `BugCaseFile.chain` carries it to the PR body, the drawer and the gates.
 */
export const BUG_CHAIN_LINKS = [
  'observed',
  'reproduced',
  'located',
  'changed',
  'resolved',
  'held',
] as const;
export type BugChainLink = (typeof BUG_CHAIN_LINKS)[number];

/** present: evidenced. weak: there, but thin. missing: nobody filled it. broken: evidence says the opposite. */
export type BugChainLinkStatus = 'present' | 'weak' | 'missing' | 'broken';

export interface BugChainEntry {
  link: BugChainLink;
  status: BugChainLinkStatus;
  /** One line a reader can check: the steps, the probe, the verdict, the check. */
  evidence: string | null;
}

export interface BugCaseChain {
  links: BugChainEntry[];
  /** Links one to five all present or weak: the fix may merge. */
  mergeable: boolean;
  /** Links one to five that are missing or broken — what a merge is refused for. */
  blocking: BugChainLink[];
}

/** The links a merge needs. `held` is only knowable after release. */
export const BUG_CHAIN_MERGE_LINKS: BugChainLink[] = [
  'observed',
  'reproduced',
  'located',
  'changed',
  'resolved',
];

export const BUG_CHAIN_LINK_WORDS: Record<BugChainLink, string> = {
  observed: 'observed',
  reproduced: 'reproduced',
  located: 'located',
  changed: 'changed in that mechanism',
  resolved: 'resolved for the reporter',
  held: 'held after release',
};

const clip = (v: unknown, max = 200): string | null => {
  const flat = String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export interface ChainInput {
  source: string;
  proven: boolean;
  evidence?: string | null;
  description: string;
  file?: string | null;
  status: string;
  prUrl?: string | null;
  /** Set on a step of a cross-repo plan, whose other halves are sibling steps. */
  parentFindingId?: string | null;
  metadata?: Record<string, any> | null;
}

export function buildCaseChain(f: ChainInput): BugCaseChain {
  const metadata = f.metadata ?? {};
  const reported = f.source === BugFindingSource.REPORTED_BUG;
  const verdicts = Array.isArray(metadata.findingVerdicts)
    ? (metadata.findingVerdicts as any[])
    : [];
  const independent = verdicts[verdicts.length - 1] ?? null;
  const fault = faultLocationOf(metadata);
  const study = readBugFixStudy(metadata);
  const fixVerdict = latestVerdictFor(metadata.fixVerdicts, f.prUrl ?? null);

  // 1. observed — the symptom, where, by whom, the steps.
  const stepsLine = /(^|\n)Steps: (.+)/.exec(f.description)?.[2] ?? null;
  const observed: BugChainEntry = reported
    ? stepsLine
      ? {
          link: 'observed',
          status: 'present',
          evidence: `reporter's steps: ${clip(stepsLine)}`,
        }
      : {
          link: 'observed',
          status: 'weak',
          evidence: 'a report without steps to reproduce',
        }
    : f.proven
      ? {
          link: 'observed',
          status: 'present',
          evidence: clip(f.evidence) ?? 'tool output',
        }
      : {
          link: 'observed',
          status: 'weak',
          evidence: f.file
            ? `a reading of ${f.file}; nobody has seen it happen`
            : 'a reading of the code; nobody has seen it happen',
        };

  // 2. reproduced — the same thing made to happen, with what was seen.
  const reproduced: BugChainEntry =
    independent?.verdict === 'confirmed' && independent.reproduction
      ? {
          link: 'reproduced',
          status: 'present',
          evidence: clip(independent.reproduction),
        }
      : independent?.verdict === 'refuted'
        ? {
            link: 'reproduced',
            status: 'broken',
            evidence: clip(independent.refutation) ?? 'refuted by the verifier',
          }
        : f.proven
          ? {
              link: 'reproduced',
              status: 'present',
              evidence: 'proven by tool output',
            }
          : { link: 'reproduced', status: 'missing', evidence: null };

  // 3. located — layer, repo, mechanism, with the probe or the code read.
  const located: BugChainEntry = fault
    ? fault.layer === 'unknown'
      ? {
          link: 'located',
          status: 'weak',
          evidence: 'the verifier could not say which layer',
        }
      : {
          link: 'located',
          status: 'present',
          evidence: `${fault.layer}${fault.repo ? ` in ${fault.repo}` : ''}${fault.evidence ? `: ${clip(fault.evidence, 160)}` : ''}`,
        }
    : independent?.verdict === 'confirmed' && !reported
      ? {
          link: 'located',
          status: 'weak',
          evidence:
            'confirmed from the code; the verifier did not name the layer',
        }
      : f.proven && f.file
        ? {
            link: 'located',
            status: 'weak',
            evidence: `the finder named ${f.file}; the layer was not verified`,
          }
        : { link: 'located', status: 'missing', evidence: null };

  // 4. changed — a PR whose study agrees with the located layer.
  const changed: BugChainEntry = !f.prUrl
    ? { link: 'changed', status: 'missing', evidence: null }
    : !study
      ? {
          link: 'changed',
          status: 'weak',
          evidence: 'a PR with no study of how the feature works',
        }
      : isDataFault(fault) &&
          (study.valueLivesIn === 'locale_file' ||
            study.valueLivesIn === 'code')
        ? {
            link: 'changed',
            status: 'broken',
            evidence: `the fault is in ${fault!.layer} and the change is in ${study.valueLivesIn}`,
          }
        : study.otherRepos.length && !f.parentFindingId
          ? {
              // The study itself says a complete fix needs other repos, and
              // this PR is the only change: one side of a contract (2026-10-16,
              // a backend-only OTP length change the clients still cap at 4).
              link: 'changed',
              status: 'broken',
              evidence: `a half-fix: the study says ${study.otherRepos.join(', ')} must change too, and there is no cross-repo plan`,
            }
          : {
              link: 'changed',
              status: 'present',
              evidence: `${study.filesToChange.length} file${study.filesToChange.length === 1 ? '' : 's'} in the ${study.valueLivesIn} the study traced`,
            };

  // 5. resolved — the reporter's symptom gone at the PR head, not only a test.
  const symptom = fixVerdict?.checks.find((c) => c.name === 'symptom_resolved');
  const resolved: BugChainEntry = fixVerdict
    ? fixVerdict.verdict === 'pass'
      ? symptom?.ok === false
        ? {
            link: 'resolved',
            status: 'broken',
            evidence:
              clip(symptom.evidence) ??
              'the symptom is still there at the PR head',
          }
        : symptom?.ok === true
          ? {
              link: 'resolved',
              status: 'present',
              evidence:
                clip(symptom.evidence) ?? 'the symptom is gone at the PR head',
            }
          : {
              link: 'resolved',
              status: 'weak',
              evidence:
                'the Verifier passed the fix on its test; the symptom itself was not re-run',
            }
      : {
          link: 'resolved',
          status: 'broken',
          evidence: clip(fixVerdict.summary) ?? 'the Verifier refused the fix',
        }
    : f.status === BugFindingStatus.MERGED ||
        f.status === BugFindingStatus.RELEASING ||
        f.status === BugFindingStatus.RELEASED
      ? {
          link: 'resolved',
          status: 'weak',
          evidence: 'merged without a Verifier verdict',
        }
      : { link: 'resolved', status: 'missing', evidence: null };

  // 6. held — still gone after release.
  const held = metadata.heldInProduction as
    | { ok: boolean; evidence?: string | null }
    | undefined;
  const heldEntry: BugChainEntry =
    metadata.regressed === true
      ? { link: 'held', status: 'broken', evidence: 'the bug came back' }
      : held
        ? held.ok
          ? {
              link: 'held',
              status: 'present',
              evidence:
                clip(held.evidence) ?? 'the symptom stayed gone in production',
            }
          : {
              link: 'held',
              status: 'broken',
              evidence:
                clip(held.evidence) ?? 'the symptom is back in production',
            }
        : f.status === BugFindingStatus.RELEASED
          ? {
              link: 'held',
              status: 'weak',
              evidence: 'released; not yet re-checked in production',
            }
          : { link: 'held', status: 'missing', evidence: null };

  const links = [observed, reproduced, located, changed, resolved, heldEntry];
  const blocking = links
    .filter(
      (l) =>
        BUG_CHAIN_MERGE_LINKS.includes(l.link) &&
        (l.status === 'missing' || l.status === 'broken'),
    )
    .map((l) => l.link);
  return { links, mergeable: blocking.length === 0, blocking };
}

/** The refusal a merge gate gives, naming the links. */
export const chainRefusal = (chain: BugCaseChain): string =>
  `This fix's case chain is not complete: ${chain.blocking
    .map((l) => {
      const entry = chain.links.find((x) => x.link === l)!;
      return `${BUG_CHAIN_LINK_WORDS[l]} is ${entry.status}${entry.evidence ? ` (${entry.evidence})` : ''}`;
    })
    .join(
      '; ',
    )}. Bug Hunter merges only a fix it can trace from the symptom to the change; a person may merge it with the force flag after reading the chain.`;
