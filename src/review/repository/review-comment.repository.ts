import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ReviewComment } from '../entity/review-comment.entity';

@Injectable()
export class ReviewCommentRepository extends Repository<ReviewComment> {
  constructor(private readonly dataSource: DataSource) {
    super(ReviewComment, dataSource.createEntityManager());
  }
}
