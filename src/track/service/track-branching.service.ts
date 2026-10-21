import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { SessionItemStatus } from 'src/common/type/common.type';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { TrackItemProgressMeta, TrackItemType } from '../type/track.type';
import {
  BRANCHING_MAX_STORED_RUNS,
  BranchingScenarioContent,
  branchingEndingScore,
  resolveBranchingPath,
  resolveBranchingRound,
} from '../type/branching.type';
import { TrackEnrollment } from '../entity/track-enrollment.entity';
import { TrackItem } from '../entity/track-item.entity';
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
 *
 * Attempts come in rounds. A learner who uses every attempt without passing is
 * paused, not stopped: a fresh round opens after BRANCHING_ROUND_COOLDOWN_MS
 * (see `resolveBranchingRound`), or as soon as a trainer resets it.
 */
@Injectable()
export class TrackBranchingService {
  private readonly logger = LoggerService.getInstance(
    TrackBranchingService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
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
    const now = new Date();
    const round = resolveBranchingRound(
      progress.meta?.branchingRoundRuns,
      maxAttempts,
      alreadyCompleted,
      now,
    );

    if (round.exhausted) {
      throw new BadRequestException({
        message: 'You have used all attempts for this scenario.',
        nextRoundAt: round.nextRoundAt,
      });
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

    const runs = [
      ...round.runs,
      { endingNodeId, score, at: now.toISOString() },
    ].slice(-BRANCHING_MAX_STORED_RUNS);
    const reached = new Set(progress.meta?.branchingEndingsReached ?? []);
    reached.add(endingNodeId);
    const bestScore = Math.max(progress.meta?.branchingBestScore ?? 0, score);
    await this.trackItemProgressRepository.update(progress.id, {
      meta: {
        ...(progress.meta ?? {}),
        branchingRunCount: (progress.meta?.branchingRunCount ?? 0) + 1,
        branchingRoundRuns: runs,
        branchingEndingsReached: [...reached],
        branchingLastPath: path,
        branchingBestScore: bestScore,
        branchingLastScore: score,
      },
    });

    const completion = passed
      ? await this.trackProgressService.completeItem(progress.id, {})
      : null;

    const after = resolveBranchingRound(
      runs,
      maxAttempts,
      passed || alreadyCompleted,
      now,
    );
    this.logger.info(
      `Branching scenario run for track item ${trackItemId}: ending ${endingNodeId}, score ${score}, passed ${passed}`,
    );
    return {
      endingNodeId,
      score,
      passScore,
      passed,
      attemptsUsed: after.attemptsUsed,
      maxAttempts,
      attemptsLeft:
        maxAttempts === null
          ? null
          : Math.max(0, maxAttempts - after.attemptsUsed),
      exhausted: after.exhausted,
      nextRoundAt: after.nextRoundAt,
      recap: after.exhausted ? after.runs : [],
      bestScore,
      endingsReached: [...reached],
      itemCompleted: passed || alreadyCompleted,
      completion,
    };
  }

  /**
   * Trainer action: reopen a learner's attempts now instead of waiting out the
   * cooldown. Only touches a learner in the caller's own organisation — the
   * progress row is found through its enrollment, which carries the tenant —
   * and only clears the current round, so lifetime counts and the best score
   * stay for reporting.
   */
  async resetAttempts(trackItemId: string, userId: number) {
    const tenantId = ExecutionManager.getTenantId();
    const item = await this.dataSource
      .getRepository(TrackItem)
      .findOne({ where: { id: trackItemId } });
    if (!item || item.type !== TrackItemType.BRANCHING_SCENARIO) {
      throw new NotFoundException('Scenario not found');
    }
    const progress = await this.trackItemProgressRepository.findOne({
      where: { trackItemId, userId },
    });
    const enrollment = progress
      ? await this.dataSource
          .getRepository(TrackEnrollment)
          .findOne({ where: { id: progress.trackEnrollmentId } })
      : null;
    // Same answer for "no such learner" and "not your organisation", so the
    // endpoint cannot be used to probe other tenants.
    if (!progress || !enrollment || enrollment.tenantId !== tenantId) {
      throw new NotFoundException('Learner progress not found');
    }

    await this.trackItemProgressRepository.update(progress.id, {
      meta: { ...(progress.meta ?? {}), branchingRoundRuns: [] },
    });
    this.logger.info(
      `Branching scenario attempts reset for track item ${trackItemId} (user ${userId})`,
    );
    return { success: true };
  }
  /**
   * The scenario quizzes a learner in the caller's organisation is currently
   * paused on or partway through, so a trainer can see what there is to
   * reopen. Completed items are left out: they replay freely, so there is
   * nothing to reset.
   */
  async listLearnerAttempts(userId: number) {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new NotFoundException('Learner progress not found');
    }
    const rows: Array<{
      trackId: string;
      trackTitle: string;
      trackItemId: string;
      title: string;
      content: BranchingScenarioContent | null;
      status: SessionItemStatus;
      meta: TrackItemProgressMeta | null;
    }> = await this.dataSource.query(
      `SELECT t.id AS "trackId", t.title AS "trackTitle",
              ti.id AS "trackItemId", ti.title AS "title", ti.content AS "content",
              tip.status AS "status", tip.meta AS "meta"
         FROM track_item_progress tip
         JOIN track_enrollments te ON te.id = tip."trackEnrollmentId"
         JOIN track_items ti ON ti.id = tip."trackItemId"
         JOIN tracks t ON t.id = ti."trackId"
        WHERE tip."userId" = $1
          AND te."tenantId"::text = $2
          AND te."deletedAt" IS NULL
          AND ti."deletedAt" IS NULL
          AND ti.type = $3
        ORDER BY t.title, ti."order"`,
      [userId, tenantId, TrackItemType.BRANCHING_SCENARIO],
    );
    const now = new Date();
    return rows
      .filter((row) => row.status !== SessionItemStatus.COMPLETED)
      .map((row) => {
        const maxAttempts = row.content?.settings?.maxAttempts ?? null;
        const round = resolveBranchingRound(
          row.meta?.branchingRoundRuns,
          maxAttempts,
          false,
          now,
        );
        return {
          trackId: row.trackId,
          trackTitle: row.trackTitle,
          trackItemId: row.trackItemId,
          title: row.title,
          attemptsUsed: round.attemptsUsed,
          maxAttempts,
          exhausted: round.exhausted,
          nextRoundAt: round.nextRoundAt,
          bestScore: row.meta?.branchingBestScore ?? null,
        };
      })
      .filter((row) => row.attemptsUsed > 0);
  }
}
