import { Module } from '@nestjs/common';
import { ReviewRepository } from './repository/review.repository';
import { ReviewService } from './service/review.service';
import { ReviewController } from './controller/review.controller';
import { UserModule } from 'src/user/user.module';
import { LearnModule } from 'src/learn/learn.module';

@Module({
  imports: [UserModule, LearnModule],
  controllers: [ReviewController],
  providers: [ReviewRepository, ReviewService],
})
export class ReviewModule {}
