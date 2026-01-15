import { Module } from '@nestjs/common';
import { ReviewRepository } from './repository/review.repository';
import { ReviewService } from './service/review.service';
import { ReviewController } from './controller/review.controller';
import { LearnModule } from 'src/learn/learn.module';
import { ReviewCommentRepository } from './repository/review-comment.repository';
import { ReviewThreadRepository } from './repository/review-thread.repository';
import { ReviewCommentReactionRepository } from './repository/review-comment-reaction.repository';
import { UserModule } from 'src/user/user.module';
import { ReviewReactionRepository } from './repository/review-reaction.repository';

@Module({
  imports: [LearnModule, UserModule],
  controllers: [ReviewController],
  providers: [
    ReviewRepository,
    ReviewThreadRepository,
    ReviewCommentRepository,
    ReviewCommentReactionRepository,
    ReviewReactionRepository,
    ReviewService,
  ],
})
export class ReviewModule {}
