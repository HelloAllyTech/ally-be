import { Injectable } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { Review } from '../entity/review.entity';

@Injectable()
export class ReviewRepository extends Repository<Review> {
  constructor(private readonly dataSource: DataSource) {
    super(Review, dataSource.createEntityManager());
  }
}
