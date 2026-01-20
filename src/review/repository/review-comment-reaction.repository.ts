import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ReviewCommentReaction } from '../entity/review-comment-reaction.entity';

@Injectable()
export class ReviewCommentReactionRepository extends Repository<ReviewCommentReaction> {
  constructor(private readonly dataSource: DataSource) {
    super(ReviewCommentReaction, dataSource.createEntityManager());
  }
  async getReactionAndCountByCommentIds(commentIds: string[]): Promise<any[]> {
    if (!commentIds.length) return [];

    return this.createQueryBuilder('rcr')
      .select('rcr.reviewCommentId', 'commentId')
      .addSelect('rcr.reaction', 'reaction')
      .addSelect('COUNT(*)', 'count')
      .where('rcr.reviewCommentId IN (:...commentIds)', { commentIds })
      .groupBy('rcr.reviewCommentId')
      .addGroupBy('rcr.reaction')
      .getRawMany();
  }
}
