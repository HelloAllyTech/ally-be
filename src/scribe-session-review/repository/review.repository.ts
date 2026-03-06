import { Injectable } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { ScribeSessionReview } from '../entity/review.entity';

@Injectable()
export class ScribeSessionReviewRepository extends Repository<ScribeSessionReview> {
  constructor(private readonly dataSource: DataSource) {
    super(ScribeSessionReview, dataSource.createEntityManager());
  }
}
