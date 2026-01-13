import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ReviewCommentReaction } from '../entity/review-comment-reaction.entity';

@Injectable()
export class ReviewCommentReactionRepository extends Repository<ReviewCommentReaction> {
  constructor(private readonly dataSource: DataSource) {
    super(ReviewCommentReaction, dataSource.createEntityManager());
  }
}
