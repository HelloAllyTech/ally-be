import { DataSource, EntityTarget, Repository } from 'typeorm';
import { BaseReviewThread } from '../entity/base-review-thread.entity';
import { BaseReviewComment } from '../entity/base-review-comment.entity';
import { BaseReview } from '../entity/base-review.entity';
import { ReviewCommentCount } from '../type/review-thread.type';
import { Pagination } from 'src/common/type/common.type';

export abstract class BaseReviewThreadRepository<
  TThread extends BaseReviewThread,
  TComment extends BaseReviewComment,
  TReview extends BaseReview,
> extends Repository<TThread> {
  protected abstract commentEntity: EntityTarget<TComment>;
  protected abstract reviewEntity: EntityTarget<TReview>;

  constructor(entity: EntityTarget<TThread>, dataSource: DataSource) {
    super(entity, dataSource.createEntityManager());
  }

  async getReviewThreadsByReviewId(
    reviewId: string,
    isCommentVisible: boolean,
    options?: Pagination,
  ): Promise<{ threads: TThread[]; count: number }> {
    const query = this.createQueryBuilder('reviewThread').where(
      'reviewThread.reviewId = :reviewId',
      { reviewId },
    );
    query.andWhere(
      'reviewThread.messageId IS NOT NULL AND reviewThread.selection IS NOT NULL',
    );

    if (!isCommentVisible) {
      query.andWhere(
        `EXISTS (
          SELECT 1 
          FROM ${this.getCommentTableName()} comment   
          WHERE comment."reviewThreadId" = "reviewThread".id 
          AND comment."parentCommentId" IS NULL 
          AND comment."deletedAt" IS NULL
          AND comment.hidden = false
        )`,
      );
    }

    query.orderBy('reviewThread.createdAt', 'ASC');

    if (options?.limit) {
      query.limit(options.limit);
    }
    if (options?.offset) {
      query.offset(options.offset);
    }

    const [threads, count] = await query.getManyAndCount();
    return { threads, count };
  }

  async getCommentsCountByReviewIds(
    reviewIds: string[],
    userId: number,
  ): Promise<ReviewCommentCount[]> {
    if (!reviewIds.length) return [];
    return this.createQueryBuilder('reviewThread')
      .select([
        'reviewThread.reviewId AS "reviewId"',
        'COUNT(reviewComment.id) AS "count"',
      ])
      .innerJoin(
        this.reviewEntity as any,
        'review',
        'review.id = reviewThread.reviewId',
      )
      .innerJoin(
        this.commentEntity as any,
        'reviewComment',
        `reviewComment.reviewThreadId = reviewThread.id AND (
        reviewComment.hidden = false OR 
        review.createdBy = :userId
      )`,
        { userId },
      )
      .where('reviewThread.reviewId IN (:...reviewIds)', { reviewIds })
      .groupBy('reviewThread.reviewId')
      .getRawMany();
  }

  protected abstract getCommentTableName(): string;
}
