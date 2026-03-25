import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ReviewThreadsResponseDto } from 'src/review/dto/review-threads.dto';
import { ScenarioSessionReviewThreadService } from '../service/thread.service';

@Controller({
  path: 'scenario-session-reviews',
  version: '1',
})
@ApiBearerAuth()
@ApiSecurity('access-token')
@ApiTags('Scenario Session Review')
export class ScenarioSessionReviewThreadController {
  constructor(
    private readonly reviewThreadService: ScenarioSessionReviewThreadService,
  ) {}

  @ApiOperation({ summary: 'Get review threads' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({ name: 'includeMessage', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'Review threads list',
    type: ReviewThreadsResponseDto,
  })
  @AuthPermissions([PERMISSIONS.VIEW_SIMULATION_REVIEW_THREADS])
  @Get(':reviewId/threads')
  async getReviewThreads(
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('includeMessage') includeMessage?: 'true' | 'false',
  ): Promise<ReviewThreadsResponseDto> {
    return this.reviewThreadService.getReviewThreads(reviewId, {
      limit,
      offset,
      includeMessage: includeMessage === 'true',
    });
  }
}
