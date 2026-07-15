/**
 * The single answer to "which scenario sessions count?" for evaluation and
 * analytics. Today three code paths answer it three different ways (session
 * logs exclude preview+seed, the drift judge excludes only preview, the
 * platform aggregates exclude nothing) — new code MUST use this predicate so
 * the divergence stops growing; legacy queries migrate opportunistically.
 *
 * `alias` is the scenario_sessions table alias in the calling query.
 */
export function countableSessionPredicate(alias = 's'): string {
  return (
    `${alias}."roomId" NOT LIKE 'preview-%' ` +
    `AND ${alias}."roomId" NOT LIKE 'seed-room-%'`
  );
}
