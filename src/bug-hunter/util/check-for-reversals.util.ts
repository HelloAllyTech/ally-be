import { LoggerService } from 'src/logger/logger.service';

import { BugFinding } from '../entity/bug-finding.entity';
import { BugFindingRepository } from '../repository/bug-finding.repository';
import { BugHunterService } from '../service/bug-hunter.service';
import { BugFindingStatus } from '../enum/bug-finding.enum';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';

/**
 * Closes the other loop the reversal rate needs: a finding dismissed as a
 * finder error (`not_a_bug` / `wrong_repo` / `duplicate`) that turns out to
 * have been wrong, because the same bug — same `repo` + `dedupeKey` — was
 * later found again and actually shipped.
 *
 * Keyed on `dedupeKey`, not `reportedBugId`: most findings this needs to
 * catch are sweep-discovered, which never carry a `reportedBugId` at all. A
 * dismissal declined against a different `dedupeKey` than the one that ships
 * is not caught by this — e.g. a `duplicate` dismissal pointing at a bug
 * filed under different code coordinates — which is a known gap, not a bug in
 * this function.
 *
 * Best-effort, like `releaseLinkedRoadmapOpportunity`: the finding's
 * MERGED/RELEASED status is already committed by the time this runs, so a
 * failure here must never undo it or stop whatever the caller was doing.
 */
export async function checkForAndRecordReversals(
  findingRepository: BugFindingRepository,
  bugHunterService: BugHunterService,
  finding: BugFinding,
  logger: LoggerService,
): Promise<void> {
  if (
    finding.status !== BugFindingStatus.MERGED &&
    finding.status !== BugFindingStatus.RELEASED
  ) {
    return;
  }
  if (!finding.repo || !finding.dedupeKey) return;

  try {
    const shippedAt = finding.releasedAt ?? finding.updatedAt ?? new Date();
    const reversible = await findingRepository.findReversibleFinderErrors(
      finding.repo,
      finding.dedupeKey,
      finding.id,
      shippedAt,
    );
    for (const dismissed of reversible) {
      await findingRepository.update(dismissed.id, {
        reversedAt: new Date(),
        reversedByFindingId: finding.id,
      });
      await bugHunterService.appendFindingEvent({
        findingId: dismissed.id,
        repo: finding.repo,
        stage: BugHuntEventStage.REVERSED,
        summary:
          `This dismissal was reversed: finding ${finding.id} shipped under the same dedupe key, ` +
          `so the original ${dismissed.decisionReason ?? 'dismissal'} was a finder error.`,
        payload: {
          reversedByFindingId: finding.id,
          decisionReason: dismissed.decisionReason ?? null,
        },
      });
    }
  } catch (error) {
    logger.warn(
      `Could not check for reversals of finding ${finding.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
