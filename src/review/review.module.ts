import { Module } from '@nestjs/common';
import { ReviewRepository } from './repository/review.repository';
import { ReviewService } from './service/review.service';
import { ReviewController } from './controller/review.controller';
import { LearnModule } from 'src/learn/learn.module';

@Module({
  imports: [LearnModule],
  controllers: [ReviewController],
  providers: [ReviewRepository, ReviewService],
})
export class ReviewModule {}
