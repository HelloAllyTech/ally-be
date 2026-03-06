import { Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ScribeSessionReviewService } from '../service/review.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { SuccessResponse } from 'src/common/type/common.type';

@Controller({
  path: 'scribe-session-reviews',
  version: '1',
})
@ApiBearerAuth()
@ApiSecurity('access-token')
@ApiTags('Scribe Session Review')
export class ScribeSessionReviewController {
  constructor(private readonly reviewService: ScribeSessionReviewService) {}

  @Get('/unread-count')
  @AuthPermissions([PERMISSIONS.VIEW_REVIEWS])
  @ApiOperation({ summary: 'Get unread scribe session review count' })
  @ApiResponse({
    status: 200,
    description: 'Unread review count retrieved successfully',
  })
  async getUnreadReviewCount(): Promise<{ count: number }> {
    return this.reviewService.getUnreadReviewCount();
  }

  @Patch('/:id/mark-read')
  @AuthPermissions([PERMISSIONS.VIEW_REVIEW])
  @ApiOperation({ summary: 'Mark scribe session review as read' })
  @ApiResponse({
    status: 200,
    description: 'Review marked as read successfully',
  })
  async markReviewAsRead(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SuccessResponse> {
    return this.reviewService.markReviewAsRead(id);
  }
}
