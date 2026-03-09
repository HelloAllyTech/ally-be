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
import { ScribeSessionReviewCommentService } from '../service/comment.service';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  CreateReviewCommentDto,
  CreateCommentResponseDto,
} from 'src/review/dto/create-comment.dto';
import { GetReviewRepliesResponseDto } from 'src/review/dto/review-replies-response.dto';
import { UpdateReviewCommentDto } from 'src/review/dto/update-review-comment.dto';
import { SuccessResponse } from 'src/common/type/common.type';
import { ToggleCommentVisibilityDto } from 'src/review/dto/toggle-comment-visibility.dto';
import { GetReviewCommentsResponseDto } from 'src/review/dto/review-comments-response.dto';

@Controller({
  path: 'scribe-session-reviews',
  version: '1',
})
@ApiBearerAuth()
@ApiSecurity('access-token')
@ApiTags('Scribe Session Review')
export class ScribeSessionReviewCommentController {
  constructor(
    private readonly reviewCommentService: ScribeSessionReviewCommentService,
  ) {}

  @ApiOperation({ summary: 'Add a comment' })
  @ApiResponse({ status: 201, type: CreateCommentResponseDto })
  @AuthPermissions([PERMISSIONS.EDIT_SCRIBE_REVIEW_THREAD])
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
  @AuthPermissions([PERMISSIONS.VIEW_SCRIBE_REVIEW_THREADS])
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @Get('threads/:threadId/comments')
  async getReviewComments(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<GetReviewCommentsResponseDto> {
    return this.reviewCommentService.getReviewComments(threadId, {
      limit,
      offset,
    });
  }

  @ApiOperation({ summary: 'Get review comment replies' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @AuthPermissions([PERMISSIONS.VIEW_SCRIBE_REVIEW_THREADS])
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
  @AuthPermissions([PERMISSIONS.EDIT_SCRIBE_REVIEW_THREAD])
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
  @AuthPermissions([PERMISSIONS.EDIT_SCRIBE_REVIEW_THREAD])
  @Delete('comments/:commentId')
  async deleteReviewComment(
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ): Promise<SuccessResponse> {
    return this.reviewCommentService.deleteReviewComment(commentId);
  }

  @ApiOperation({ description: 'Toggle comment visibility' })
  @AuthPermissions([PERMISSIONS.EDIT_SCRIBE_REVIEW_THREAD])
  @Patch('comments/:commentId/visibility')
  async toggleCommentVisibility(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() toggleCommentVisibilityDto: ToggleCommentVisibilityDto,
  ): Promise<SuccessResponse> {
    return this.reviewCommentService.toggleCommentVisibility(
      commentId,
      toggleCommentVisibilityDto,
    );
  }

  @ApiOperation({ summary: 'Get general review comments' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @AuthPermissions([PERMISSIONS.VIEW_SCRIBE_REVIEW_THREADS])
  @Get(':reviewId/comments')
  async getGeneralReviewComments(
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<GetReviewCommentsResponseDto> {
    return this.reviewCommentService.getGeneralReviewComments(reviewId, {
      limit,
      offset,
    });
  }
}
