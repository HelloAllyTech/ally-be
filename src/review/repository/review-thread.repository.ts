import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ReviewThread } from '../entity/review-thread.entity';

@Injectable()
export class ReviewThreadRepository extends Repository<ReviewThread> {
  constructor(private readonly dataSource: DataSource) {
    super(ReviewThread, dataSource.createEntityManager());
  }
}
