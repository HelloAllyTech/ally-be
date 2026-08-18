import { BadRequestException, Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { TrackItemType } from '../type/track.type';
import { TrackItemProgressRepository } from '../repository/track-item-progress.repository';
import { TrackEnrollmentService } from './track-enrollment.service';

/**
 * Records what a learner scored in a GAME component.
 *
 * This is a scoreboard, not a grader. The item is already COMPLETED by the
 * time a score arrives (see the GAME branch of `startItem`), so nothing here
 * unlocks, gates or scores anything — it keeps a personal best so a replay has
 * something to beat. That also means a lost or failed request costs the
 * learner nothing, which is why the player fires it and forgets it.
 */
@Injectable()
export class TrackGameService {
  private readonly logger = LoggerService.getInstance(TrackGameService.name);

  constructor(
    private readonly trackItemProgressRepository: TrackItemProgressRepository,
    private readonly trackEnrollmentService: TrackEnrollmentService,
  ) {}

  async recordResult(trackItemId: string, score: number) {
    const { item, progress } =
      await this.trackEnrollmentService.getPermittedItemProgress(trackItemId);
    if (item.type !== TrackItemType.GAME) {
      throw new BadRequestException('This component is not a game');
    }

    const previousBest = progress.meta?.bestGameScore ?? 0;
    const bestGameScore = Math.max(previousBest, score);
    const gamePlayCount = (progress.meta?.gamePlayCount ?? 0) + 1;

    await this.trackItemProgressRepository.update(progress.id, {
      meta: { ...(progress.meta ?? {}), bestGameScore, gamePlayCount },
    });

    this.logger.info(
      `Game result recorded for track item ${trackItemId}: score ${score}`,
    );
    return { bestScore: bestGameScore, playCount: gamePlayCount, score };
  }
}
