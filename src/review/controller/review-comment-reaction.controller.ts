import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { SuccessResponse } from 'src/common/type/common.type';
import { ToggleReviewCommentReactionDto } from '../dto/toggle-review-comment-reaction.dto';
import { ReviewCommentReactionService } from '../service/review-comment-reaction.service';

@Controller({
  path: 'reviews',
  version: '1',
})
@ApiBearerAuth()
@ApiSecurity('access-token')
@ApiTags('Review')
export class ReviewCommentReactionController {
  constructor(
    private readonly reviewCommentReactionService: ReviewCommentReactionService,
  ) {}

  @ApiOperation({ description: 'Toggle review comment reaction' })
  @AuthPermissions([PERMISSIONS.EDIT_REVIEW_THREAD])
  @Post('comments/:commentId/reactions')
  async toggleReviewCommentReaction(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() toggleReviewCommentReactionDto: ToggleReviewCommentReactionDto,
  ): Promise<SuccessResponse> {
    return this.reviewCommentReactionService.toggleReviewCommentReaction(
      commentId,
      toggleReviewCommentReactionDto,
    );
  }
}
