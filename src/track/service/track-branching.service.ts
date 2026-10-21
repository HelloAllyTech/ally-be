import { BadRequestException, Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackItemType } from '../type/track.type';
import {
  BranchingScenarioContent,
  branchingEndingScore,
  resolveBranchingPath,
} from '../type/branching.type';
import { TrackItemProgressRepository } from '../repository/track-item-progress.repository';
import { TrackEnrollmentService } from './track-enrollment.service';
import { TrackProgressService } from './track-progress.service';

/**
 * Records a finished run of a BRANCHING_SCENARIO and applies its gate.
 *
 * The scenario has no answer key, so the learner's client plays it locally and
 * reports the choices it made once an ending is reached. The server walks that
 * path through the authored graph before believing it, and takes the score
 * from the ending it lands on — never from the client. A run is an attempt.
 *
 * With a pass mark, only a run scoring at least that completes the item;
 * without one, reaching any ending does. An item that is already COMPLETED can
 * be replayed freely: the attempt limit is a gate to cross, not a cap on
 * practising afterwards.
 */
@Injectable()
export class TrackBranchingService {
  private readonly logger = LoggerService.getInstance(
    TrackBranchingService.name,
  );

  constructor(
    private readonly trackItemProgressRepository: TrackItemProgressRepository,
    private readonly trackEnrollmentService: TrackEnrollmentService,
    private readonly trackProgressService: TrackProgressService,
  ) {}

  async recordResult(trackItemId: string, path: string[]) {
    const { item, progress } =
      await this.trackEnrollmentService.getPermittedItemProgress(trackItemId);
    if (item.type !== TrackItemType.BRANCHING_SCENARIO) {
      throw new BadRequestException(
        'This component is not a branching scenario',
      );
    }

    const content = item.content as BranchingScenarioContent;
    const passScore = content.settings?.passScore || null;
    const maxAttempts = content.settings?.maxAttempts ?? null;
    const alreadyCompleted = progress.status === SessionItemStatus.COMPLETED;
    const attemptsBefore = progress.meta?.branchingRunCount ?? 0;

    if (
      !alreadyCompleted &&
      maxAttempts !== null &&
      attemptsBefore >= maxAttempts
    ) {
      throw new BadRequestException(
        'You have used all attempts for this scenario.',
      );
    }

    const endingNodeId = resolveBranchingPath(content, path);
    if (!endingNodeId) {
      throw new BadRequestException(
        'That path does not lead to an ending of this scenario',
      );
    }
    const ending = content.nodes.find((n) => n.id === endingNodeId)!;
    const score = branchingEndingScore(ending);
    const passed = passScore === null || score >= passScore;

    const reached = new Set(progress.meta?.branchingEndingsReached ?? []);
    reached.add(endingNodeId);
    const attemptsUsed = attemptsBefore + 1;
    const bestScore = Math.max(progress.meta?.branchingBestScore ?? 0, score);
    await this.trackItemProgressRepository.update(progress.id, {
      meta: {
        ...(progress.meta ?? {}),
        branchingRunCount: attemptsUsed,
        branchingEndingsReached: [...reached],
        branchingLastPath: path,
        branchingBestScore: bestScore,
        branchingLastScore: score,
      },
    });

    const completion = passed
      ? await this.trackProgressService.completeItem(progress.id, {})
      : null;
    this.logger.info(
      `Branching scenario run for track item ${trackItemId}: ending ${endingNodeId}, score ${score}, passed ${passed}`,
    );
    return {
      endingNodeId,
      score,
      passScore,
      passed,
      attemptsUsed,
      maxAttempts,
      attemptsLeft:
        maxAttempts === null ? null : Math.max(0, maxAttempts - attemptsUsed),
      bestScore,
      endingsReached: [...reached],
      itemCompleted: passed || alreadyCompleted,
      completion,
    };
  }
}
