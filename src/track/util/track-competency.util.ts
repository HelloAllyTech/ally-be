/**
 * `tracks.competencyIds`: the competencies an author says a course teaches.
 *
 * Read by Analytics → Course impact, which prefers this explicit tag over the
 * set it otherwise derives from the course's roleplay scenarios
 * (`scenarios.competencyIds`). Stored the way scenarios store the same thing —
 * a jsonb array of `competencies.id` uuid strings — and with the same
 * empty-means-NULL rule as `resolveCompetencySelection`, so NULL is the single
 * "not tagged, fall back" state.
 */

/** Just what the resolver needs from a `competencies` row. */
export interface TrackCompetencyCandidate {
  id: string;
  isCustom: boolean;
}

/**
 * Dedupes (first occurrence wins, so the author's order survives) and drops
 * blanks. An empty selection is NULL rather than `[]`: clearing the field means
 * "not tagged", and a stored `[]` would read as "tagged with nothing" and
 * switch the analytics fallback off.
 */
export const normaliseTrackCompetencyIds = (
  ids: readonly (string | null | undefined)[] | null | undefined,
): string[] | null => {
  if (!ids) return null;
  const unique = [
    ...new Set(
      ids.filter((id): id is string => typeof id === 'string' && id !== ''),
    ),
  ];
  return unique.length > 0 ? unique : null;
};

/**
 * Decides what a save stores, given what the author sent, what the course is
 * already tagged with, and the `competencies` rows the requested ids matched.
 *
 *  - A NEW id must be an existing, shared (non-custom) competency. Custom
 *    competencies are private to their owner and are never read by Course
 *    impact, so tagging a shared course with one would both hide a tag from
 *    every other editor and claim a reading that never happens. Anything else
 *    is `rejected` and the save should fail.
 *  - An id the course ALREADY carries is never the reason a save fails: it is
 *    kept while its competency exists and dropped silently once it has been
 *    deleted (there is nothing left for it to point at). Otherwise deleting a
 *    competency in the library would block every later edit of every course
 *    that named it, including edits that never touched this field.
 */
export const resolveTrackCompetencyIds = (input: {
  requested: readonly string[] | null | undefined;
  stored: readonly string[] | null | undefined;
  found: readonly TrackCompetencyCandidate[];
}): { ids: string[] | null; rejected: string[] } => {
  const requested = normaliseTrackCompetencyIds(input.requested) ?? [];
  const stored = new Set(input.stored ?? []);
  const byId = new Map(input.found.map((row) => [row.id, row]));

  const kept: string[] = [];
  const rejected: string[] = [];
  for (const id of requested) {
    const row = byId.get(id);
    if (stored.has(id)) {
      if (row) kept.push(id);
      continue;
    }
    if (row && !row.isCustom) {
      kept.push(id);
    } else {
      rejected.push(id);
    }
  }
  return { ids: kept.length > 0 ? kept : null, rejected };
};
