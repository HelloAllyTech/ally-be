import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { UpdateReviewCommentDto } from '../dto/update-review-comment.dto';
import { SuccessResponse } from 'src/common/type/common.type';
import { ToggleCommentVisibilityDto } from '../dto/toggle-comment-visibility.dto';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';

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

  @ApiOperation({ summary: 'Edit a review comment' })
  @ApiResponse({
    status: 200,
    description: 'Review comment edited successfully',
  })
  @AuthPermissions([PERMISSIONS.EDIT_REVIEW_THREAD])
  @Patch('comments/:commentId')
  async editReviewComment(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() updateReviewCommentDto: UpdateReviewCommentDto,
  ): Promise<SuccessResponse> {
    return this.reviewCommentService.editReviewComment(
      commentId,
      updateReviewCommentDto,
    );
  }

  @ApiOperation({ summary: 'Delete a review comment' })
  @ApiResponse({
    status: 200,
    description: 'Review comment deleted successfully',
  })
  @AuthPermissions([PERMISSIONS.EDIT_REVIEW_THREAD])
  @Delete('comments/:commentId')
  async deleteReviewComment(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser() user: TokenUser,
  ): Promise<SuccessResponse> {
    return this.reviewCommentService.deleteReviewComment(
      commentId,
      user.tenantId,
    );
  }

  @ApiOperation({ description: 'Toggle comment visibility ' })
  @AuthPermissions([PERMISSIONS.EDIT_REVIEW_THREAD])
  @Patch('comments/:commentId/visibility')
  async toggleCommentVisibility(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() toggleCommentVisibilityDto: ToggleCommentVisibilityDto,
  ) {
    return this.reviewCommentService.toggleCommentVisibility(
      commentId,
      toggleCommentVisibilityDto,
    );
  }
}
