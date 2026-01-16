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
import { ReviewThreadsResponseDto } from '../dto/review-threads.dto';
import { ReviewThreadService } from '../service/review-thread.service';

@Controller({
  path: 'reviews',
  version: '1',
})
@ApiBearerAuth()
@ApiSecurity('access-token')
@ApiTags('Review')
export class ReviewThreadController {
  constructor(private readonly reviewThreadService: ReviewThreadService) {}

  @ApiOperation({ summary: 'Get review threads' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of threads to return',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of threads to skip',
  })
  @ApiResponse({
    status: 200,
    description: 'Review threads list',
    type: ReviewThreadsResponseDto,
  })
  @AuthPermissions([PERMISSIONS.VIEW_REVIEW_THREADS])
  @Get(':reviewId/threads')
  async getReviewThreads(
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<ReviewThreadsResponseDto> {
    return this.reviewThreadService.getReviewThreads(reviewId, {
      limit,
      offset,
    });
  }
}
