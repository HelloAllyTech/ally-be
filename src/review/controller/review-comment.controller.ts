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
import { GetReviewRepliesResponseDto } from '../dto/review-replies-response.dto';

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

  @ApiOperation({ summary: 'Get review comments by thread' })
  @ApiResponse({
    status: 200,
    description: 'Review comments retrieved successfully',
  })
  @AuthPermissions([PERMISSIONS.VIEW_REVIEW_THREADS])
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of comments to return',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of comments to skip',
  })
  @Get('threads/:threadId/comments')
  async getReviewComments(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.reviewCommentService.getReviewComments(threadId, {
      limit,
      offset,
    });
  }

  @ApiOperation({ summary: 'Get review comment replies' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of replies to return',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of replies to skip',
  })
  @AuthPermissions([PERMISSIONS.VIEW_REVIEW_THREADS])
  @Get('comments/:commentId/replies')
  async getReviewCommentReplies(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<GetReviewRepliesResponseDto> {
    return this.reviewCommentService.getReviewCommentReplies(commentId, {
      limit,
      offset,
    });
  }
}
