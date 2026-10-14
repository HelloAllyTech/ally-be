import { createHash } from 'crypto';
import { isBuilderRepo } from '../constants/builder-repos.constants';
import {
  BuilderPrdDocument,
  BuilderTechnicalDesign,
} from '../type/builder-prd.type';

/**
 * The technical design's pure half: what makes one approvable, and how a
 * design knows the PRD under it has moved.
 *
 * Kept out of the services so the admin endpoints, the pipeline's `design`
 * tool response and the build gate all answer "is this design good enough?"
 * with the same function. Three readers each deriving it is how the admin's
 * Approve button and the API's refusal drift apart.
 */

/** Keys that are about the document's machinery, not the product it describes. */
const NON_PRODUCT_KEYS = new Set(['technicalDesign', 'ui']);

/** JSON with every object's keys sorted, so equal documents hash equally. */
const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
};

/**
 * A fingerprint of the product PRD: everything a person decided, and nothing
 * the design itself or the interviewer's progress flags write.
 *
 * Excluding `technicalDesign` is what lets the design be stored on the PRD
 * without making itself stale on every write. Excluding `ui` is what lets the
 * interviewer tick a progress box without invalidating an approved design that
 * nothing material has changed under.
 */
export function productHashOf(doc: BuilderPrdDocument): string {
  const record = (doc ?? {}) as unknown as Record<string, unknown>;
  const product: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (!NON_PRODUCT_KEYS.has(key)) product[key] = record[key];
  }
  return createHash('sha256').update(stableStringify(product)).digest('hex');
}

/** A design under way, before the designer has written a word of it. */
export function createDraftingDesign(
  doc: BuilderPrdDocument,
  runId: string | null,
  replacing?: BuilderTechnicalDesign | null,
): BuilderTechnicalDesign {
  // Only a draft that was actually written is worth handing on; a failed or
  // never-submitted one has nothing to fix.
  const previous = replacing?.designMd?.trim()
    ? {
        designMd: replacing.designMd,
        scope: replacing.scope ?? [],
        contracts: replacing.contracts ?? [],
        compatibilityMd: replacing.compatibilityMd ?? '',
        testMap: replacing.testMap ?? [],
        openDecisions: replacing.openDecisions ?? [],
        review: replacing.review ?? null,
      }
    : (replacing?.previous ?? null);
  return {
    previous,
    status: 'drafting',
    runId,
    designMd: '',
    scope: [],
    contracts: [],
    compatibilityMd: '',
    testMap: [],
    openDecisions: [],
    review: null,
    productHash: productHashOf(doc),
    draftedAt: null,
    approvedBy: null,
    approvedAt: null,
    error: null,
  };
}

/**
 * A scope entry as a matcher, with the same semantics as the build's hard
 * scope check (`globToRegExp` in scripts/builder/check-scope.mjs): `**`
 * crosses directories, `*` does not, a trailing slash means "anything under".
 * Approval and the build must agree on what a scope admits.
 */
export function scopeGlobToRegExp(glob: string): RegExp {
  let pattern = glob.replace(/^\.\//, '');
  if (pattern.endsWith('/')) pattern += '**';
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (ch === '*') {
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

/** Below this, a design is a heading and a promise, not a design. */
export const DESIGN_MIN_LENGTH = 200;

export interface BuilderDesignReadiness {
  ready: boolean;
  stale: boolean;
  blockers: string[];
}

/**
 * Whether the technical design is good enough to approve and build from.
 *
 * Every blocker is something the build would otherwise have to guess at, and
 * each is phrased as the next action because two readers act on the list: the
 * designer, which gets it back from the `design` tool and fixes what it says,
 * and the admin, who sees why Approve is disabled.
 *
 * `ignoreStatus` is for the designer's own submissions, which are by
 * definition not yet approved — telling it "the design is not in review" on
 * the call that puts it into review would be noise it might try to act on.
 */
export function computeDesignReadiness(
  doc: BuilderPrdDocument,
  options: { ignoreStatus?: boolean } = {},
): BuilderDesignReadiness {
  const design = doc?.technicalDesign ?? null;
  if (!design) {
    return {
      ready: false,
      stale: false,
      blockers: ['No technical design yet — draft one from the PRD panel.'],
    };
  }

  const blockers: string[] = [];

  if (
    !options.ignoreStatus &&
    design.status !== 'review' &&
    design.status !== 'approved'
  ) {
    blockers.push(
      design.status === 'failed'
        ? `The design run failed${design.error ? `: ${design.error}` : ''}. Draft it again.`
        : 'The design is still being drafted.',
    );
  }

  const designMd = String(design.designMd ?? '').trim();
  if (designMd.length < DESIGN_MIN_LENGTH) {
    blockers.push(
      designMd.length
        ? `designMd is too thin to build from (${designMd.length} characters; at least ${DESIGN_MIN_LENGTH}).`
        : 'designMd is empty.',
    );
  }

  const scope = Array.isArray(design.scope) ? design.scope : [];
  if (!scope.length) {
    blockers.push(
      'scope is empty — name the exact files the build may change, per repo. ' +
        'It becomes the build’s hard scope check.',
    );
  }
  const unknownRepos = scope
    .map((entry) => String(entry?.repo ?? '').trim())
    .filter((repo) => !isBuilderRepo(repo));
  if (unknownRepos.length) {
    blockers.push(
      `scope names repos Builder cannot work in: ${unknownRepos
        .map((repo) => repo || '(blank)')
        .join(', ')}.`,
    );
  }
  const emptyScopes = scope
    .filter(
      (entry) =>
        !(Array.isArray(entry?.files) ? entry.files : []).some((file) =>
          String(file ?? '').trim(),
        ),
    )
    .map((entry) => String(entry?.repo ?? '').trim() || '(blank)');
  if (emptyScopes.length) {
    blockers.push(`scope lists no files for: ${emptyScopes.join(', ')}.`);
  }

  const contracts = Array.isArray(design.contracts) ? design.contracts : [];
  const unread = contracts
    .filter(
      (contract) =>
        !(Array.isArray(contract?.readers) ? contract.readers : []).some(
          (reader) => String(reader ?? '').trim(),
        ),
    )
    .map((contract) => String(contract?.name ?? '').trim() || '(unnamed)');
  if (unread.length) {
    // Zero readers is never the true answer for a contract worth listing —
    // at the very least the code that declares it reads it. An empty list
    // means the search was not done, which is the exact failure this design
    // stage exists to prevent.
    blockers.push(
      `No readers found for: ${unread.join(', ')}. grep every cloned repo and ` +
        'list each reader as repo:path:line.',
    );
  }
  if (contracts.length && !String(design.compatibilityMd ?? '').trim()) {
    blockers.push(
      'compatibilityMd is empty — say how released clients keep working with each changed contract.',
    );
  }

  const mapped = new Set(
    (Array.isArray(design.testMap) ? design.testMap : []).map((test) =>
      String(test?.requirementId ?? '').trim(),
    ),
  );
  const unmapped = (doc.requirements ?? [])
    .map((requirement) => String(requirement?.id ?? '').trim())
    .filter((id) => id && !mapped.has(id));
  if (unmapped.length) {
    blockers.push(
      `testMap has no test for: ${unmapped.join(', ')}. Map every requirement to a test file and what it asserts.`,
    );
  }

  // A mapped test the scope does not cover is a test the build cannot write:
  // the hard scope check refuses it. Session 880e73e6's run 7 mapped a
  // helpline player spec while scoping only the player.
  const scopeByRepo = new Map<string, RegExp[]>();
  for (const entry of scope) {
    const repo = String(entry?.repo ?? '').trim();
    const files = (Array.isArray(entry?.files) ? entry.files : [])
      .map((file) => String(file ?? '').trim())
      .filter(Boolean);
    scopeByRepo.set(repo, [
      ...(scopeByRepo.get(repo) ?? []),
      ...files.map(scopeGlobToRegExp),
    ]);
  }
  const outOfScopeTests = [
    ...new Set(
      (Array.isArray(design.testMap) ? design.testMap : [])
        .map((test) => ({
          repo: String(test?.repo ?? '').trim(),
          file: String(test?.file ?? '')
            .trim()
            .replace(/^\.\//, ''),
        }))
        .filter(
          ({ repo, file }) =>
            file &&
            !(scopeByRepo.get(repo) ?? []).some((matcher) =>
              matcher.test(file),
            ),
        )
        .map(({ repo, file }) => `${repo || '(blank)'}:${file}`),
    ),
  ];
  // An empty scope already blocks on its own; listing every test again is noise.
  if (scope.length && outOfScopeTests.length) {
    blockers.push(
      `testMap names test files the scope does not include: ${outOfScopeTests.join(', ')}. ` +
        'Add each to its repo’s scope — the build cannot write a file outside it.',
    );
  }

  const openDecisions = (
    Array.isArray(design.openDecisions) ? design.openDecisions : []
  ).filter((decision) => String(decision ?? '').trim());
  if (openDecisions.length) {
    blockers.push(
      `${openDecisions.length} open decision(s) need a person — settle them in the PRD, then redraft.`,
    );
  }

  const stale = productHashOf(doc) !== design.productHash;
  if (stale) {
    blockers.push(
      'The PRD changed after this design was drafted — redraft it from the current PRD.',
    );
  }

  return { ready: blockers.length === 0, stale, blockers };
}

/**
 * The PRD as a build of only `repos` should see it: the approved design's
 * scope and test map cut to those repos.
 *
 * One repo per build means the ally-web run must not be handed ally-be's files
 * as its scope or ally-be's tests as its obligations — it would either build
 * them or fail the scope check trying. Contracts stay whole: a changed field is
 * one contract with readers on both sides, and the client build needs the
 * server's side of it to read the field correctly. The prose (designMd,
 * compatibilityMd) stays too; it cannot be cut by repo and it explains why.
 *
 * A copy: the stored document, and the product hash computed from it, are
 * untouched.
 */
export function sliceDesignForRepos(
  doc: BuilderPrdDocument,
  repos: string[] | null | undefined,
): BuilderPrdDocument {
  const design = doc?.technicalDesign;
  if (!design || !repos?.length) return doc;
  const keep = new Set(repos);
  return {
    ...doc,
    technicalDesign: {
      ...design,
      scope: (design.scope ?? []).filter((entry) => keep.has(entry?.repo)),
      testMap: (design.testMap ?? []).filter((test) => keep.has(test?.repo)),
    },
  };
}
