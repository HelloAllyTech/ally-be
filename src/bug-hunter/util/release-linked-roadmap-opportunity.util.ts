import { Repository } from 'typeorm';

import { LoggerService } from 'src/logger/logger.service';
import { RoadmapOpportunity } from 'src/product-roadmap/entity/roadmap-opportunity.entity';
import { RoadmapOpportunityStage } from 'src/product-roadmap/enum/roadmap-opportunity.enum';

import { BUG_HUNTER_AGENT_ROADMAP_OWNER } from '../constants/bug-fix-session.constants';
import { BugFinding } from '../entity/bug-finding.entity';

/**
 * Closes the loop the other direction: a reported bug's roadmap card shouldn't
 * sit at whatever stage it was filed in once the fix that addresses it has
 * actually merged.
 *
 * `reportedBugId` is only ever set on a finding created from a roadmap bug
 * report (`RoadmapOpportunityService.create`) — a repo-wide sweep finding has
 * none, and for a coordinated multi-repo plan only the PARENT carries it, never
 * the per-repo steps, so this is a no-op for both. Best-effort, like the roadmap
 * side's own reciprocal write: the finding's MERGED status is already committed
 * by the time this runs, so a failure here must never undo it or stop whatever
 * the caller was in the middle of.
 *
 * Lives here rather than on one service because a finding reaches MERGED by
 * three separate routes, and every one of them has to close the card: the fix
 * agent PATCHing its own `gh pr merge --admin` (`BugFindingService.setStatus`,
 * which is the common path — both the on-demand session and the nightly
 * sweep's auto-merges land there), the reconcile pass noticing a hand-merged
 * PR, and a coordinated plan's last step landing.
 */
export async function releaseLinkedRoadmapOpportunity(
  repository: Repository<RoadmapOpportunity>,
  finding: BugFinding,
  logger: LoggerService,
): Promise<void> {
  if (!finding.reportedBugId) return;

  try {
    const opportunity = await repository.findOne({
      where: { id: finding.reportedBugId },
    });
    if (!opportunity) return;

    await repository.update(finding.reportedBugId, {
      stage: RoadmapOpportunityStage.RELEASED,
      owner: BUG_HUNTER_AGENT_ROADMAP_OWNER,
      ownerUserId: null,
      ...(opportunity.stage !== RoadmapOpportunityStage.RELEASED
        ? { releasedAt: new Date() }
        : {}),
    });
  } catch (error) {
    logger.warn(
      `Could not release linked roadmap opportunity ${finding.reportedBugId} for finding ${finding.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
