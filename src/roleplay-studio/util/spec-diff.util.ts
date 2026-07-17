/**
 * Structural diff between two spec documents → changed-path list
 * [{ path, before, after }] for the improvement run's cumulative-diff view.
 * Objects recurse; arrays and scalars are compared as whole values (a spec
 * array edit reads better as one before/after block than as index-level ops).
 */

export interface SpecDiffEntry {
  path: string;
  before: unknown;
  after: unknown;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function diffSpecDocuments(
  base: Record<string, any> | null | undefined,
  candidate: Record<string, any> | null | undefined,
  pathPrefix = '',
): SpecDiffEntry[] {
  const entries: SpecDiffEntry[] = [];
  const baseObject = base ?? {};
  const candidateObject = candidate ?? {};
  const keys = new Set([
    ...Object.keys(baseObject),
    ...Object.keys(candidateObject),
  ]);

  for (const key of keys) {
    const path = `${pathPrefix}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
    const before = (baseObject as Record<string, unknown>)[key];
    const after = (candidateObject as Record<string, unknown>)[key];

    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if (isPlainObject(before) && isPlainObject(after)) {
      entries.push(...diffSpecDocuments(before, after, path));
      continue;
    }
    entries.push({ path, before, after });
  }
  return entries;
}
