import { forwardRef, Module } from '@nestjs/common';
import { LearnModule } from 'src/learn/learn.module';
import { UserModule } from 'src/user/user.module';
import { BadgeModule } from 'src/badge/badge.module';
import { ReviewAccessValidator } from 'src/review/util/review-access-policy.util';
import { ScenarioSessionReviewRepository } from './repository/review.repository';
import { ScenarioSessionReviewThreadRepository } from './repository/thread.repository';
import { ScenarioSessionReviewCommentRepository } from './repository/comment.repository';
import { ScenarioSessionReviewReactionRepository } from './repository/reaction.repository';
import { ScenarioSessionReviewCommentReactionRepository } from './repository/comment-reaction.repository';
import { ScenarioSessionReviewReadStatusRepository } from './repository/read-status.repository';
import { ScenarioSessionReviewService } from './service/review.service';
import { ScenarioSessionReviewCommentService } from './service/comment.service';
import { ScenarioSessionReviewThreadService } from './service/thread.service';
import { ScenarioSessionReviewReactionService } from './service/reaction.service';
import { ScenarioSessionReviewCommentReactionService } from './service/comment-reaction.service';
import { ScenarioSessionReviewSharedService } from './service/review-shared.service';
import { ScenarioSessionReviewController } from './controller/review.controller';
import { ScenarioSessionReviewCommentController } from './controller/comment.controller';
import { ScenarioSessionReviewThreadController } from './controller/thread.controller';
import { ScenarioSessionReviewReactionController } from './controller/reaction.controller';
import { ScenarioSessionReviewCommentReactionController } from './controller/comment-reaction.controller';

@Module({
  imports: [
    forwardRef(() => LearnModule),
    forwardRef(() => UserModule),
    forwardRef(() => BadgeModule),
  ],
  controllers: [
    ScenarioSessionReviewController,
    ScenarioSessionReviewThreadController,
    ScenarioSessionReviewCommentController,
    ScenarioSessionReviewReactionController,
    ScenarioSessionReviewCommentReactionController,
  ],
  providers: [
    ScenarioSessionReviewRepository,
    ScenarioSessionReviewThreadRepository,
    ScenarioSessionReviewCommentRepository,
    ScenarioSessionReviewReactionRepository,
    ScenarioSessionReviewCommentReactionRepository,
    ScenarioSessionReviewReadStatusRepository,
    ScenarioSessionReviewService,
    ScenarioSessionReviewCommentService,
    ScenarioSessionReviewThreadService,
    ScenarioSessionReviewReactionService,
    ScenarioSessionReviewCommentReactionService,
    ScenarioSessionReviewSharedService,
    ReviewAccessValidator,
  ],
  exports: [ScenarioSessionReviewSharedService],
})
export class ScenarioSessionReviewModule {}
