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
import { ScenarioSessionReviewCommentReactionService } from '../service/comment-reaction.service';

@Controller({
  path: 'scenario-session-reviews',
  version: '1',
})
@ApiBearerAuth()
@ApiSecurity('access-token')
@ApiTags('Scenario Session Review')
export class ScenarioSessionReviewCommentReactionController {
  constructor(
    private readonly reviewCommentReactionService: ScenarioSessionReviewCommentReactionService,
  ) {}

  @ApiOperation({ description: 'Toggle review comment reaction' })
  @AuthPermissions([PERMISSIONS.EDIT_SIMULATION_REVIEW_THREAD])
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
