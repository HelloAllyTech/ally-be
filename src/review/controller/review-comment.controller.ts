import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ReviewCommentService } from '../service/review-comment.service';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  CreateReviewCommentDto,
  CreateCommentResponseDto,
} from '../dto/create-comment.dto';

@Controller({
  path: 'reviews',
  version: '1',
})
@ApiBearerAuth()
@ApiSecurity('access-token')
@ApiTags('Review')
export class ReviewCommentController {
  constructor(private readonly reviewCommentService: ReviewCommentService) {}

  @ApiOperation({ summary: 'Add a comment' })
  @ApiResponse({
    status: 201,
    description: 'Comment added successfully',
    type: CreateCommentResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_REVIEW_THREAD])
  @Post(':reviewId/comments')
  async addComment(
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body() createReviewCommentDto: CreateReviewCommentDto,
  ): Promise<CreateCommentResponseDto> {
    return this.reviewCommentService.addCommentToReview(
      reviewId,
      createReviewCommentDto,
    );
  }
}
