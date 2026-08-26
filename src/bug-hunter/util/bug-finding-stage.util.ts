import { RoadmapOpportunityStage } from 'src/product-roadmap/enum/roadmap-opportunity.enum';

import { BugFinding } from '../entity/bug-finding.entity';
import { BugFindingStatus } from '../enum/bug-finding.enum';

/**
 * The coarse New → Prioritised → In development → Released ladder, for a bug.
 *
 * This is the roadmap's own vocabulary (RoadmapOpportunityStage, reused verbatim
 * rather than re-declared so the two can never drift), shown here because bugs no
 * longer appear on the roadmap board at all — Bug Hunter is the only place a bug
 * is listed, so the stage a reader is used to has to be readable here.
 *
 * DERIVED, not stored, for the ordinary case. A bug moving through the pipeline
 * moves its own stage with it, so there is nothing to hand-maintain and nothing
 * that can go stale — which matters more than usual now that no board exists on
 * which someone would have noticed a bug frozen at "New" for a month.
 *
 * The exhaustive Record is the point: adding a BugFindingStatus without deciding
 * which stage it reads as is a compile error, not a silent fall-through to New.
 */
const STAGE_BY_STATUS: Record<BugFindingStatus, RoadmapOpportunityStage> = {
  // Filed, or found and awaiting a decision — nobody has committed to it yet.
  [BugFindingStatus.NEW]: RoadmapOpportunityStage.NEW,
  [BugFindingStatus.PENDING_APPROVAL]: RoadmapOpportunityStage.NEW,

  // Someone has said yes and it is waiting its turn.
  [BugFindingStatus.APPROVED]: RoadmapOpportunityStage.PRIORITISED,
  [BugFindingStatus.QUEUED]: RoadmapOpportunityStage.PRIORITISED,

  // Work is genuinely underway. NEEDS_INPUT belongs here rather than back at New:
  // the work started and is blocked on an answer, which is a different thing from
  // nobody having picked it up.
  [BugFindingStatus.FIXING]: RoadmapOpportunityStage.UNDER_DEVELOPMENT,
  [BugFindingStatus.NEEDS_INPUT]: RoadmapOpportunityStage.UNDER_DEVELOPMENT,
  [BugFindingStatus.PR_OPENED]: RoadmapOpportunityStage.UNDER_DEVELOPMENT,
  [BugFindingStatus.BLOCKED]: RoadmapOpportunityStage.UNDER_DEVELOPMENT,
  [BugFindingStatus.COORDINATING]: RoadmapOpportunityStage.UNDER_DEVELOPMENT,

  // MERGED and RELEASING read as Released deliberately. The roadmap ladder has no
  // "merged but not deployed" rung, and the honest coarse answer for a fix that has
  // landed on master is that it is done — the exact deploy state is what the
  // pipeline status beside it is for.
  [BugFindingStatus.MERGED]: RoadmapOpportunityStage.RELEASED,
  [BugFindingStatus.RELEASING]: RoadmapOpportunityStage.RELEASED,
  [BugFindingStatus.RELEASED]: RoadmapOpportunityStage.RELEASED,

  // Everything that ended without a fix shipping. FAILED and RELEASE_FAILED sit here
  // rather than in development because no work is in flight on them; that they are
  // retryable is, again, the pipeline status's job to say.
  [BugFindingStatus.DISMISSED]: RoadmapOpportunityStage.ARCHIVED,
  [BugFindingStatus.REJECTED]: RoadmapOpportunityStage.ARCHIVED,
  [BugFindingStatus.CANCELLED]: RoadmapOpportunityStage.ARCHIVED,
  [BugFindingStatus.FAILED]: RoadmapOpportunityStage.ARCHIVED,
  [BugFindingStatus.RELEASE_FAILED]: RoadmapOpportunityStage.ARCHIVED,
};

/** The stage this finding's pipeline status implies, ignoring any manual override. */
export function deriveStage(status: BugFindingStatus): RoadmapOpportunityStage {
  return STAGE_BY_STATUS[status] ?? RoadmapOpportunityStage.NEW;
}

/**
 * The stage to SHOW: a manual override if one was set, otherwise the derived one.
 *
 * An override pins the stage permanently — later pipeline transitions no longer move
 * it. That is the deliberate choice: an admin sets this when a bug was fixed OUTSIDE
 * Bug Hunter (a hand-written PR, a config change, a fix that rode along with other
 * work), in which case the pipeline's own status is not tracking reality and letting
 * it overwrite the correction would undo the only accurate value on the row. Clearing
 * the override (`setStage(id, null)`) hands the row back to derivation.
 */
export function effectiveStage(
  finding: Pick<BugFinding, 'status' | 'stageOverride'>,
): RoadmapOpportunityStage {
  return finding.stageOverride ?? deriveStage(finding.status);
}
