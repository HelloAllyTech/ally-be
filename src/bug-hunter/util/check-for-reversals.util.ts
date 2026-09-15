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
 *
 * `shippedAt` is the caller's own record of the moment the finding actually
 * shipped — not derived from `finding.releasedAt`/`updatedAt` here, because
 * several callers write the new status straight through
 * `findingRepository.update()` and then patch the in-memory `finding` object
 * without reloading it, leaving `updatedAt` pointing at whenever the row was
 * originally fetched rather than the ship time. Passing the timestamp in
 * keeps this function from silently under-counting reversals decided in that
 * gap.
 */
export async function checkForAndRecordReversals(
  findingRepository: BugFindingRepository,
  bugHunterService: BugHunterService,
  finding: BugFinding,
  logger: LoggerService,
  shippedAt: Date,
): Promise<void> {
  if (
    finding.status !== BugFindingStatus.MERGED &&
    finding.status !== BugFindingStatus.RELEASED
  ) {
    return;
  }
  if (!finding.repo || !finding.dedupeKey) return;

  let reversible: BugFinding[];
  try {
    reversible = await findingRepository.findReversibleFinderErrors(
      finding.repo,
      finding.dedupeKey,
      finding.id,
      shippedAt,
    );
  } catch (error) {
    logger.warn(
      `Could not check for reversals of finding ${finding.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return;
  }

  if (!reversible.length) return;

  const reversedAt = new Date();
  await findingRepository.update(
    reversible.map((dismissed) => dismissed.id),
    { reversedAt, reversedByFindingId: finding.id },
  );

  for (const dismissed of reversible) {
    try {
      await bugHunterService.appendFindingEvent({
        findingId: dismissed.id,
        repo: finding.repo,
        stage: BugHuntEventStage.REVERSED,
        summary:
          `This dismissal was reversed: finding ${finding.id} shipped under the same dedupe key, ` +
          `so the original ${dismissed.decisionReason ? `${dismissed.decisionReason} ` : ''}dismissal was mistaken — the finder was right.`,
        payload: {
          reversedByFindingId: finding.id,
          decisionReason: dismissed.decisionReason ?? null,
        },
      });
    } catch (error) {
      logger.warn(
        `Marked finding ${dismissed.id} reversed but could not append its event: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
