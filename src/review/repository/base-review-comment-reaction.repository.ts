import { DataSource, EntityTarget, Repository } from 'typeorm';
import { BaseReviewCommentReaction } from '../entity/base-review-comment-reaction.entity';
import { BaseReviewComment } from '../entity/base-review-comment.entity';
import { BaseReviewThread } from '../entity/base-review-thread.entity';
import { BaseReview } from '../entity/base-review.entity';
import { CommentReactionCount } from '../type/review-comment-reaction.type';

export abstract class BaseReviewCommentReactionRepository<
  TCommentReaction extends BaseReviewCommentReaction,
  TComment extends BaseReviewComment,
  TThread extends BaseReviewThread,
  TReview extends BaseReview,
> extends Repository<TCommentReaction> {
  protected abstract commentEntity: EntityTarget<TComment>;
  protected abstract threadEntity: EntityTarget<TThread>;
  protected abstract reviewEntity: EntityTarget<TReview>;

  constructor(entity: EntityTarget<TCommentReaction>, dataSource: DataSource) {
    super(entity, dataSource.createEntityManager());
  }

  async getReactionAndCountByCommentIds(
    commentIds: string[],
  ): Promise<CommentReactionCount[]> {
    if (!commentIds.length) return [];

    return this.createQueryBuilder('reviewCommentReaction')
      .select('reviewCommentReaction.reviewCommentId', 'commentId')
      .addSelect('reviewCommentReaction.reaction', 'reaction')
      .addSelect('COUNT(*)', 'count')
      .where('reviewCommentReaction.reviewCommentId IN (:...commentIds)', {
        commentIds,
      })
      .groupBy('reviewCommentReaction.reviewCommentId')
      .addGroupBy('reviewCommentReaction.reaction')
      .getRawMany();
  }

  async getGivenCommentsReactionsCountPerUser(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; count: number }[]> {
    if (!tenantIds?.length && !userIds?.length) {
      return [];
    }

    const query = this.createQueryBuilder('rcr')
      .innerJoin(this.commentEntity as any, 'rc', 'rc.id = rcr.reviewCommentId')
      .innerJoin(this.threadEntity as any, 'rt', 'rt.id = rc.reviewThreadId')
      .innerJoin(this.reviewEntity as any, 'r', 'r.id = rt.reviewId')
      .where('r.createdBy != rcr.createdBy')
      .select('rcr.createdBy', 'userId')
      .addSelect('COUNT(rcr.id)', 'count')
      .groupBy('rcr.createdBy');

    if (userIds) {
      query.andWhere('rcr.createdBy IN (:...userIds)', { userIds });
    }
    if (tenantIds) {
      query.andWhere('rcr.tenantId IN (:...tenantIds)', { tenantIds });
    }

    return query.getRawMany();
  }

  async getReceivedCommentsReactionsCountPerUser(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; count: number }[]> {
    if (!tenantIds?.length && !userIds?.length) {
      return [];
    }

    const query = this.createQueryBuilder('rcr')
      .innerJoin(this.commentEntity as any, 'rc', 'rc.id = rcr.reviewCommentId')
      .innerJoin(this.threadEntity as any, 'rt', 'rt.id = rc.reviewThreadId')
      .innerJoin(this.reviewEntity as any, 'r', 'r.id = rt.reviewId')
      .select('r.createdBy', 'userId')
      .addSelect('COUNT(rcr.id)', 'count')
      .groupBy('r.createdBy');

    if (userIds) {
      query.andWhere('r.createdBy IN (:...userIds)', { userIds });
    }
    if (tenantIds) {
      query.andWhere('r.tenantId IN (:...tenantIds)', { tenantIds });
    }

    return query.getRawMany();
  }
}
