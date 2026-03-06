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
import { ToggleReviewCommentReactionDto } from 'src/review/dto/toggle-review-comment-reaction.dto';
import { ScribeSessionReviewCommentReactionService } from '../service/comment-reaction.service';

@Controller({
  path: 'scribe-session-reviews',
  version: '1',
})
@ApiBearerAuth()
@ApiSecurity('access-token')
@ApiTags('Scribe Session Review')
export class ScribeSessionReviewCommentReactionController {
  constructor(
    private readonly reviewCommentReactionService: ScribeSessionReviewCommentReactionService,
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
