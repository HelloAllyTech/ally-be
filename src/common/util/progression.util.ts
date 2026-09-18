/**
 * Shared "did this roleplay clear the item's score gate?" helper. Used by ALL
 * THREE progression engines — Track 2.0 (`TrackProgressService.handleRoleplayEnd`),
 * the legacy Learning Pathway
 * (`ScenarioPathSessionService.handleEndScenarioPathSession`) and Cases
 * (`CaseSessionService.handleEndCaseSession`) — so what counts as passing is
 * decided in exactly one place and cannot drift between them.
 *
 * Two facts make the naive `score < minimumScore` comparison wrong:
 *
 *  1. **0 is the unconfigured default, not a bar to clear.** Every builder
 *     surface presents "Minimum score" as an optional field, and the DTOs pin
 *     it at `@Min(0)`; older builders pre-seeded a literal 0 on every item
 *     added. A designer who never opens the field still ships an item
 *     carrying 0.
 *  2. **A roleplay score can be negative.** `totalScore` is a plain SUM over
 *     `scenario_session_events.score`, and detected events carry penalties as
 *     well as credit (see the `score: -20` seed fixtures); the learner-facing
 *     score meter runs -100..100. A negative score is an ordinary outcome,
 *     not an error.
 *
 * Together those locked learners out of the rest of a track: they finished the
 * first simulation, scored below zero, and the next simulation stayed LOCKED
 * forever against a minimum the designer never set. A zero minimum therefore
 * means "no score gate — completing the item is enough", which is how the
 * sibling `minReadSeconds: 0` criterion already reads.
 *
 * A positive minimum is enforced exactly as before, including the `?? 0` on a
 * missing score: when scoring never produced a number we treat it as 0 so the
 * learner retries rather than clearing a real gate by accident.
 */
export const meetsMinimumScore = (
  score: number | null | undefined,
  minimumScore: number | null | undefined,
): boolean => {
  // Never configured — a NULL `minimumScore` column, or an absent `minScore`
  // key in the `completionCriteria` JSONB. Nothing to clear.
  if (minimumScore === null || minimumScore === undefined) {
    return true;
  }
  // Explicitly configured and kept as a real value (0 is NOT coerced to
  // "unset" anywhere) — but 0 reads as "no bar", not as "must be >= 0".
  if (minimumScore <= 0) {
    return true;
  }
  return (score ?? 0) >= minimumScore;
};
