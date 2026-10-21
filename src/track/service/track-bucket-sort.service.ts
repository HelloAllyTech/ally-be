import { BadRequestException, Injectable } from '@nestjs/common';
import { SessionItemStatus } from 'src/common/type/common.type';
import { LoggerService } from 'src/logger/logger.service';
import { TrackItemType } from '../type/track.type';
import { BucketSortContent } from '../type/bucket-sort.type';
import { TrackItemProgressRepository } from '../repository/track-item-progress.repository';
import { TrackEnrollmentService } from './track-enrollment.service';
import { TrackProgressService } from './track-progress.service';
import { feedbackFor } from './track-bucket-sort.sanitizer';

/**
 * Checks one placement of a BUCKET_SORT item at a time.
 *
 * The answer key stays on the server: the client sends "this item, this
 * bucket" and gets the verdict, the right bucket and the author's explanation
 * back. Only the learner's FIRST placement of an item is recorded — it is the
 * guess that exposes a misconception — and asking again returns the stored
 * verdict instead of letting a wrong guess be quietly retried. The item
 * completes when every item has been placed, whatever the score: this is
 * practice, not a gate.
 */
@Injectable()
export class TrackBucketSortService {
  private readonly logger = LoggerService.getInstance(
    TrackBucketSortService.name,
  );

  constructor(
    private readonly trackItemProgressRepository: TrackItemProgressRepository,
    private readonly trackEnrollmentService: TrackEnrollmentService,
    private readonly trackProgressService: TrackProgressService,
  ) {}

  async checkPlacement(
    trackItemId: string,
    sortItemId: string,
    bucketId: string,
  ) {
    const { item, progress } =
      await this.trackEnrollmentService.getPermittedItemProgress(trackItemId);
    if (item.type !== TrackItemType.BUCKET_SORT) {
      throw new BadRequestException('This component is not a bucket sort');
    }
    const content = item.content as BucketSortContent;
    const sortItem = content.items.find((i) => i.id === sortItemId);
    if (!sortItem) {
      throw new BadRequestException('That item is not part of this sort');
    }
    if (!content.buckets.some((b) => b.id === bucketId)) {
      throw new BadRequestException('That bucket is not part of this sort');
    }

    const answers = { ...(progress.meta?.bucketSortAnswers ?? {}) };
    const existing = answers[sortItemId];
    let completion = null;
    let firstTryPct: number | null = null;

    if (!existing) {
      answers[sortItemId] = {
        bucketId,
        correct: sortItem.bucketId === bucketId,
      };
      const finished = content.items.every((i) => answers[i.id]);
      const meta = { ...(progress.meta ?? {}), bucketSortAnswers: answers };
      if (finished) {
        firstTryPct = this.firstTryPct(content, answers);
        meta.bucketSortBestFirstTryPct = Math.max(
          meta.bucketSortBestFirstTryPct ?? 0,
          firstTryPct,
        );
        meta.bucketSortRounds = (meta.bucketSortRounds ?? 0) + 1;
      }
      await this.trackItemProgressRepository.update(progress.id, { meta });
      if (finished && progress.status !== SessionItemStatus.COMPLETED) {
        completion = await this.trackProgressService.completeItem(
          progress.id,
          {},
        );
      }
      this.logger.info(
        `Bucket sort placement for track item ${trackItemId}: correct ${answers[sortItemId].correct}`,
      );
    }

    const answer = answers[sortItemId];
    const finished = content.items.every((i) => answers[i.id]);
    if (finished && firstTryPct === null) {
      firstTryPct = this.firstTryPct(content, answers);
    }
    return {
      sortItemId,
      ...feedbackFor(content, sortItemId, answer)!,
      placedCount: Object.keys(answers).length,
      totalCount: content.items.length,
      finished,
      firstTryPct,
      itemCompleted:
        finished || progress.status === SessionItemStatus.COMPLETED,
      completion,
    };
  }

  /**
   * Start another round. Only allowed once the current round is finished:
   * resetting mid-round would let a learner see the verdict on an item and
   * then guess it again, which erases the very thing this records.
   */
  async startNewRound(trackItemId: string) {
    const { item, progress } =
      await this.trackEnrollmentService.getPermittedItemProgress(trackItemId);
    if (item.type !== TrackItemType.BUCKET_SORT) {
      throw new BadRequestException('This component is not a bucket sort');
    }
    const content = item.content as BucketSortContent;
    const answers = progress.meta?.bucketSortAnswers ?? {};
    if (!content.items.every((i) => answers[i.id])) {
      throw new BadRequestException(
        'Finish placing every item before starting again.',
      );
    }
    await this.trackItemProgressRepository.update(progress.id, {
      meta: { ...(progress.meta ?? {}), bucketSortAnswers: {} },
    });
    return { success: true };
  }

  private firstTryPct(
    content: BucketSortContent,
    answers: Record<string, { correct: boolean }>,
  ): number {
    const right = content.items.filter((i) => answers[i.id]?.correct).length;
    return Math.round((right / content.items.length) * 100);
  }
}
