import { RoadmapOpportunityStage } from '../enum/roadmap-opportunity.enum';

/**
 * Which stages put an opportunity beyond reshaping.
 *
 * Split and merge rewrite an opportunity's identity: a split rewords the source and hands its
 * contributors' votes to parts that did not exist when they voted, and a merge soft-deletes its
 * sources and moves their votes onto the survivor. Both are fine while the thing is still a
 * plan. Neither is fine once it is a record:
 *
 *   RELEASED  — the month it shipped in is a fact, `releasedAt` is stamped, and release notes
 *               snapshot the ids that shipped. Reshaping it rewrites what we told people we did.
 *   ARCHIVED  — a deliberate "this is not happening", carrying the votes that were cast
 *               deciding that. Folding it into something live launders that decision.
 *
 * ONE list, consulted by both operations, because "released is different" applied in one of the
 * two places is how the board starts disagreeing with itself. Mirrored on the frontend by
 * isReshapeableStage in pages/ProductRoadmap/utils/stages.ts, which only disables the buttons —
 * this is the enforcement.
 *
 * NOTE FOR ANYONE RELAXING THIS: `split()` used to inherit `releasedAt` onto the parts of a
 * released source, precisely so a split could never re-stamp a ship date. That branch was
 * removed when this guard made it unreachable — if RELEASED is ever allowed back through here,
 * restore it, or splitting a shipped opportunity will silently produce parts that look unshipped.
 */
export const ROADMAP_UNRESHAPEABLE_STAGES: readonly RoadmapOpportunityStage[] =
  [RoadmapOpportunityStage.RELEASED, RoadmapOpportunityStage.ARCHIVED];

/** Whether split and merge may still touch an opportunity in this stage. */
export function isReshapeableStage(
  stage: RoadmapOpportunityStage | string | null | undefined,
): boolean {
  return !ROADMAP_UNRESHAPEABLE_STAGES.includes(
    stage as RoadmapOpportunityStage,
  );
}

/**
 * The 409 message, naming every offender and its stage.
 *
 * Named, not counted: a merge can carry a dozen rows, and "3 of these cannot be merged" sends the
 * manager back to the board to work out which three. Stage values are quoted raw, matching the
 * allocation service's stage-rule message rather than inventing a second vocabulary server-side.
 */
export function unreshapeableMessage(
  operation: 'split' | 'merge',
  offenders: { id: string; stage: RoadmapOpportunityStage }[],
): string {
  const listed = offenders
    .map(({ id, stage }) => `${id} ("${stage}")`)
    .join(', ');
  const subject = offenders.length === 1 ? 'it is' : 'they are';
  return (
    `Cannot ${operation}: ${listed} — ${subject} already released or archived. ` +
    `Reshaping a shipped or abandoned opportunity would rewrite a record other things ` +
    `already point at. Votes and comments are untouched.`
  );
}
