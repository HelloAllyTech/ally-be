import { forwardRef, Module } from '@nestjs/common';
import { ReviewRepository } from './repository/review.repository';
import { ReviewService } from './service/review.service';
import { ReviewController } from './controller/review.controller';
import { LearnModule } from 'src/learn/learn.module';
import { ReviewCommentRepository } from './repository/review-comment.repository';
import { ReviewThreadRepository } from './repository/review-thread.repository';
import { ReviewCommentReactionRepository } from './repository/review-comment-reaction.repository';
import { UserModule } from 'src/user/user.module';
import { ReviewReactionRepository } from './repository/review-reaction.repository';
import { ReviewCommentController } from './controller/review-comment.controller';
import { ReviewThreadController } from './controller/review-thread.controller';
import { ReviewCommentService } from './service/review-comment.service';
import { ReviewThreadService } from './service/review-thread.service';
import { ReviewSharedService } from './service/review-shared.service';
import { ReviewReactionController } from './controller/review-reaction-controller';
import { ReviewCommentReactionController } from './controller/review-comment-reaction.controller';
import { ReviewReactionService } from './service/review-reaction.service';
import { ReviewCommentReactionService } from './service/review-comment-reaction.service';

@Module({
  imports: [forwardRef(() => LearnModule), forwardRef(() => UserModule)],
  controllers: [
    ReviewController,
    ReviewThreadController,
    ReviewCommentController,
    ReviewReactionController,
    ReviewCommentReactionController,
  ],
  providers: [
    ReviewRepository,
    ReviewThreadRepository,
    ReviewCommentRepository,
    ReviewCommentReactionRepository,
    ReviewReactionRepository,
    ReviewService,
    ReviewThreadService,
    ReviewCommentService,
    ReviewSharedService,
    ReviewReactionService,
    ReviewCommentReactionService,
  ],
  exports: [ReviewSharedService],
})
export class ReviewModule {}
