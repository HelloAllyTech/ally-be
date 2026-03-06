import { forwardRef, Module } from '@nestjs/common';
import { UserModule } from 'src/user/user.module';
import { ReviewAccessValidator } from 'src/review/util/review-access-policy.util';
import { ScribeSessionReviewRepository } from './repository/review.repository';
import { ScribeSessionReviewThreadRepository } from './repository/thread.repository';
import { ScribeSessionReviewCommentRepository } from './repository/comment.repository';
import { ScribeSessionReviewReactionRepository } from './repository/reaction.repository';
import { ScribeSessionReviewCommentReactionRepository } from './repository/comment-reaction.repository';
import { ScribeSessionReviewReadStatusRepository } from './repository/read-status.repository';
import { ScribeSessionReviewService } from './service/review.service';
import { ScribeSessionReviewCommentService } from './service/comment.service';
import { ScribeSessionReviewThreadService } from './service/thread.service';
import { ScribeSessionReviewReactionService } from './service/reaction.service';
import { ScribeSessionReviewCommentReactionService } from './service/comment-reaction.service';
import { ScribeSessionReviewSharedService } from './service/review-shared.service';
import { ScribeSessionReviewController } from './controller/review.controller';
import { ScribeSessionReviewCommentController } from './controller/comment.controller';
import { ScribeSessionReviewThreadController } from './controller/thread.controller';
import { ScribeSessionReviewReactionController } from './controller/reaction.controller';
import { ScribeSessionReviewCommentReactionController } from './controller/comment-reaction.controller';

@Module({
  imports: [forwardRef(() => UserModule)],
  controllers: [
    ScribeSessionReviewController,
    ScribeSessionReviewThreadController,
    ScribeSessionReviewCommentController,
    ScribeSessionReviewReactionController,
    ScribeSessionReviewCommentReactionController,
  ],
  providers: [
    ScribeSessionReviewRepository,
    ScribeSessionReviewThreadRepository,
    ScribeSessionReviewCommentRepository,
    ScribeSessionReviewReactionRepository,
    ScribeSessionReviewCommentReactionRepository,
    ScribeSessionReviewReadStatusRepository,
    ScribeSessionReviewService,
    ScribeSessionReviewCommentService,
    ScribeSessionReviewThreadService,
    ScribeSessionReviewReactionService,
    ScribeSessionReviewCommentReactionService,
    ScribeSessionReviewSharedService,
    ReviewAccessValidator,
  ],
  exports: [ScribeSessionReviewSharedService],
})
export class ScribeSessionReviewModule {}
