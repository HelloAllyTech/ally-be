import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { SuccessResponse } from 'src/common/type/common.type';
import { GetReviewReactionsResponseDto } from 'src/review/dto/review-reaction-response.dto';
import { ToggleReviewReactionDto } from 'src/review/dto/toggle-review-reaction.dto';
import { ScenarioSessionReviewReactionService } from '../service/reaction.service';
import { GetReviewReactionCountResponseDto } from 'src/review/dto/get-review-reaction-and-count-response.dto';

@Controller({
  path: ['scenario-session-reviews', 'reviews'],
  version: '1',
})
@ApiBearerAuth()
@ApiSecurity('access-token')
@ApiTags('Scenario Session Review')
export class ScenarioSessionReviewReactionController {
  constructor(
    private readonly reviewReactionService: ScenarioSessionReviewReactionService,
  ) {}

  @ApiOperation({ description: 'Toggle review reaction' })
  @AuthPermissions([PERMISSIONS.EDIT_REVIEW_THREAD])
  @Post(':reviewId/reactions')
  async toggleReviewReactions(
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body() toggleReviewReactionDto: ToggleReviewReactionDto,
  ): Promise<SuccessResponse> {
    return this.reviewReactionService.toggleReviewReactions(
      reviewId,
      toggleReviewReactionDto,
    );
  }

  @ApiOperation({ description: 'Get review reactions' })
  @AuthPermissions([PERMISSIONS.VIEW_REVIEW_THREADS])
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({ name: 'reaction', required: false, type: String })
  @Get(':reviewId/reactions')
  async getReviewReactions(
    @Param('reviewId') reviewId: string,
    @Query('reaction') reaction?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<GetReviewReactionsResponseDto> {
    return this.reviewReactionService.getReviewReactions(reviewId, {
      reaction,
      limit,
      offset,
    });
  }

  @ApiOperation({ description: 'Get review reactions and its count' })
  @AuthPermissions([PERMISSIONS.VIEW_REVIEW_THREADS])
  @Get(':reviewId/reactions/count')
  async getReviewReactionsAndCount(
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
  ): Promise<GetReviewReactionCountResponseDto> {
    return this.reviewReactionService.getReviewReactionsAndCount(reviewId);
  }
}
