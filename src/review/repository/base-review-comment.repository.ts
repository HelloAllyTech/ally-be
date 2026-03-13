import { DataSource, EntityTarget, Repository } from 'typeorm';
import { BaseReviewComment } from '../entity/base-review-comment.entity';
import { BaseReviewThread } from '../entity/base-review-thread.entity';
import { BaseReview } from '../entity/base-review.entity';
import { Pagination } from 'src/common/type/common.type';
import { CommentCountByThread } from '../type/review-thread.type';
import {
  CommentForThreadIdsResult,
  GetCommentsByThreadIdResult,
} from '../type/review-comment.type';

export abstract class BaseReviewCommentRepository<
  TComment extends BaseReviewComment,
  TThread extends BaseReviewThread,
  TReview extends BaseReview,
> extends Repository<TComment> {
  protected abstract threadEntity: EntityTarget<TThread>;
  protected abstract reviewEntity: EntityTarget<TReview>;

  constructor(entity: EntityTarget<TComment>, dataSource: DataSource) {
    super(entity, dataSource.createEntityManager());
  }

  async getCommentsForThreadIds(
    threadIds: string[],
    isCommentVisible: boolean,
  ): Promise<CommentForThreadIdsResult[]> {
    if (!threadIds.length) {
      return [];
    }

    const query = this.createQueryBuilder('comment')
      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(*)', 'count')
          .from(this.target, 'reviewComment')
          .where(
            'reviewComment.parentCommentId = comment.id  AND (:isCommentVisible = true OR reviewComment.hidden = false)',
            { isCommentVisible },
          );
      }, 'reply_count')
      .addSelect(
        `ROW_NUMBER() OVER (PARTITION BY comment."reviewThreadId" ORDER BY comment."createdAt" DESC)`,
        'row_num',
      )
      .where('comment.reviewThreadId IN (:...threadIds)', { threadIds })
      .andWhere('comment.parentCommentId IS NULL');
    if (!isCommentVisible) {
      query.andWhere('comment.hidden = false');
    }
    return query.addOrderBy('comment.createdAt', 'DESC').getRawMany();
  }

  async getCommentsByThreadId(
    threadId: string,
    isCommentVisible: boolean,
    options?: Pagination,
  ): Promise<GetCommentsByThreadIdResult> {
    const { limit = 20, offset = 0 } = options || {};

    const query = this.createQueryBuilder('comment')
      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(*)', 'count')
          .from(this.target, 'reviewComment')
          .where(
            'reviewComment.parentCommentId = comment.id AND (:isCommentVisible = true OR reviewComment.hidden = false)',
            { isCommentVisible },
          )
          .andWhere('reviewComment.deletedAt IS NULL');
      }, 'reply_count')
      .where('comment.reviewThreadId = :threadId', { threadId })
      .andWhere('comment.parentCommentId IS NULL');

    if (!isCommentVisible) {
      query.andWhere('(comment.hidden = false)');
    }

    const count = await query.getCount();

    if (options?.sortBy) {
      query.orderBy(`comment.${options.sortBy}`, options.order);
    }

    const comments = await query.limit(limit).offset(offset).getRawMany();

    return { comments, count };
  }

  async getRepliesByCommentId(
    commentId: string,
    isCommentVisible: boolean,
    options?: Pagination,
  ) {
    const { limit = 20, offset = 0 } = options || {};
    const query = this.createQueryBuilder('comment').where(
      'comment.parentCommentId = :commentId',
      { commentId },
    );
    if (!isCommentVisible) {
      query.andWhere('comment.hidden=false');
    }

    if (options?.sortBy) {
      query.orderBy(`comment.${options.sortBy}`, options.order);
    }

    query.limit(limit).offset(offset);
    return query.getManyAndCount();
  }

  async getGivenCommentsCountPerUser(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; count: number }[]> {
    if (!tenantIds?.length && !userIds?.length) {
      return [];
    }

    const query = this.createQueryBuilder('rc')
      .innerJoin(this.threadEntity as any, 'rt', 'rt.id = rc.reviewThreadId')
      .innerJoin(this.reviewEntity as any, 'r', 'r.id = rt.reviewId')
      .where('r.createdBy != rc.createdBy')
      .select('rc.createdBy', 'userId')
      .addSelect('COUNT(rc.id)', 'count')
      .groupBy('rc.createdBy');

    if (userIds) {
      query.andWhere('rc.createdBy IN (:...userIds)', { userIds });
    }
    if (tenantIds) {
      query.andWhere('rc.tenantId IN (:...tenantIds)', { tenantIds });
    }

    return query.getRawMany();
  }

  async getReceivedCommentsCountPerUser(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; count: number }[]> {
    if (!tenantIds?.length && !userIds?.length) {
      return [];
    }

    const query = this.createQueryBuilder('rc')
      .innerJoin(this.threadEntity as any, 'rt', 'rt.id = rc.reviewThreadId')
      .innerJoin(this.reviewEntity as any, 'r', 'r.id = rt.reviewId')
      .where('r.createdBy != rc.createdBy')
      .select('r.createdBy', 'userId')
      .addSelect('COUNT(rc.id)', 'count')
      .groupBy('r.createdBy');

    if (userIds) {
      query.andWhere('r.createdBy IN (:...userIds)', { userIds });
    }
    if (tenantIds) {
      query.andWhere('r.tenantId IN (:...tenantIds)', { tenantIds });
    }

    return query.getRawMany();
  }

  async getRootCommentCountByThreadId(
    threadId: string,
    isCommentVisible: boolean,
  ): Promise<number> {
    const query = this.createQueryBuilder('comment')
      .where('comment.reviewThreadId = :threadId', { threadId })
      .andWhere('comment.parentCommentId IS NULL');
    if (!isCommentVisible) {
      query.andWhere('comment.hidden = false');
    }
    return query.getCount();
  }

  async getCommentCountsByThreadIds(
    threadIds: string[],
    isCommentVisible: boolean,
  ): Promise<CommentCountByThread[]> {
    if (!threadIds.length) {
      return [];
    }
    const query = this.createQueryBuilder('comment')
      .select('comment.reviewThreadId', 'reviewThreadId')
      .addSelect('COUNT(*)', 'commentCount')
      .where('comment.reviewThreadId IN (:...threadIds)', { threadIds })
      .andWhere('comment.parentCommentId IS NULL')
      .andWhere('comment.deletedAt IS NULL');

    if (!isCommentVisible) {
      query.andWhere('comment.hidden = false');
    }
    return query.groupBy('comment.reviewThreadId').getRawMany();
  }
}
