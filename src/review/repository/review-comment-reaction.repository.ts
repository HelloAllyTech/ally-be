import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ReviewCommentReaction } from '../entity/review-comment-reaction.entity';
import { ReviewComment } from '../entity/review-comment.entity';
import { ReviewThread } from '../entity/review-thread.entity';
import { Review } from '../entity/review.entity';
import { CommentReactionCount } from '../type/review-comment-reaction.type';

@Injectable()
export class ReviewCommentReactionRepository extends Repository<ReviewCommentReaction> {
  constructor(private readonly dataSource: DataSource) {
    super(ReviewCommentReaction, dataSource.createEntityManager());
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
      .innerJoin(ReviewComment, 'rc', 'rc.id = rcr.reviewCommentId')
      .innerJoin(ReviewThread, 'rt', 'rt.id = rc.reviewThreadId')
      .innerJoin(Review, 'r', 'r.id = rt.reviewId')
      .where('rc.createdBy != rcr.createdBy')
      .andWhere('r.createdBy != rcr.createdBy') // only count reactions on others' sessions
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
      .innerJoin(ReviewComment, 'rc', 'rc.id = rcr.reviewCommentId')
      .innerJoin(ReviewThread, 'rt', 'rt.id = rc.reviewThreadId')
      .innerJoin(Review, 'r', 'r.id = rt.reviewId')
      .where('rc.createdBy != rcr.createdBy')
      .andWhere('r.createdBy != rc.createdBy') // only count reactions on comments that are on others' sessions
      .select('rc.createdBy', 'userId')
      .addSelect('COUNT(rcr.id)', 'count')
      .groupBy('rc.createdBy');

    if (userIds) {
      query.andWhere('rc.createdBy IN (:...userIds)', { userIds });
    }
    if (tenantIds) {
      query.andWhere('rc.tenantId IN (:...tenantIds)', { tenantIds });
    }

    return query.getRawMany();
  }
}
