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
import { ScribeSessionReviewThreadService } from '../service/thread.service';

@Controller({
  path: 'scribe-session-reviews',
  version: '1',
})
@ApiBearerAuth()
@ApiSecurity('access-token')
@ApiTags('Scribe Session Review')
export class ScribeSessionReviewThreadController {
  constructor(
    private readonly reviewThreadService: ScribeSessionReviewThreadService,
  ) {}

  @ApiOperation({ summary: 'Get review threads' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({ name: 'includeMessage', required: false, type: String })
  @ApiResponse({ status: 200, type: ReviewThreadsResponseDto })
  @AuthPermissions([PERMISSIONS.VIEW_SCRIBE_REVIEW_THREADS])
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
