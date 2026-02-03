import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ReviewComment } from '../entity/review-comment.entity';
import { Pagination } from 'src/common/type/common.type';
import { ReviewThread } from '../entity/review-thread.entity';
import { Review } from '../entity/review.entity';
import { CommentCountByThread } from '../type/review-thread.type';
import {
  CommentForThreadIdsResult,
  GetCommentsByThreadIdResult,
} from '../type/review-comment.type';

@Injectable()
export class ReviewCommentRepository extends Repository<ReviewComment> {
  constructor(private readonly dataSource: DataSource) {
    super(ReviewComment, dataSource.createEntityManager());
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
          .from(ReviewComment, 'reviewComment')
          .where(
            'reviewComment.parentCommentId = comment.id  AND (:isCommentVisible = true OR reviewComment.hidden = false)',
            { isCommentVisible },
          );
      }, 'reply_count')
      .addSelect(
        `ROW_NUMBER() OVER (PARTITION BY comment."reviewThreadId" ORDER BY comment."createdAt" ASC)`,
        'row_num',
      )
      .where('comment.reviewThreadId IN (:...threadIds)', { threadIds })
      .andWhere('comment.parentCommentId IS NULL');
    if (!isCommentVisible) {
      query.andWhere('comment.hidden = false');
    }
    return query.addOrderBy('comment.createdAt', 'ASC').getRawMany();
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
          .from(ReviewComment, 'reviewComment')
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

    const comments = await query
      .orderBy('comment.createdAt', 'ASC')
      .limit(limit)
      .offset(offset)
      .getRawMany();

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

    query.orderBy('comment.createdAt', 'ASC').limit(limit).offset(offset);
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
      .innerJoin(ReviewThread, 'rt', 'rt.id = rc.reviewThreadId')
      .innerJoin(Review, 'r', 'r.id = rt.reviewId')
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
      .innerJoin(ReviewThread, 'rt', 'rt.id = rc.reviewThreadId')
      .innerJoin(Review, 'r', 'r.id = rt.reviewId')
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
