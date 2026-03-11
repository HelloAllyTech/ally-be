import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import { ScribeSessionReviewService } from '../service/review.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { SortOrder, SuccessResponse } from 'src/common/type/common.type';
import { UpdateReviewDto } from 'src/review/dto/update-review.dto';
import { ReviewSortBy } from 'src/review/type/review.type';
import {
  CreateScribeSessionReviewDto,
  CreateScribeSessionReviewResponseDto,
} from '../dto/create-review.dto';
import { GetReviewMessagesResponseDto } from 'src/review/dto/review-messages-response.dto';

@Controller({
  path: 'scribe-session-reviews',
  version: '1',
})
@ApiBearerAuth()
@ApiSecurity('access-token')
@ApiTags('Scribe Session Review')
export class ScribeSessionReviewController {
  constructor(private readonly reviewService: ScribeSessionReviewService) {}

  @ApiOperation({ summary: 'Create scribe session review' })
  @ApiResponse({
    status: 201,
    description: 'Scribe session review created successfully',
    type: CreateScribeSessionReviewResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCRIBE_REVIEW])
  @Post()
  async createReview(
    @Body() createReviewDto: CreateScribeSessionReviewDto,
  ): Promise<CreateScribeSessionReviewResponseDto> {
    return this.reviewService.createReview(createReviewDto);
  }

  @ApiOperation({ summary: 'Update scribe session review status or note' })
  @ApiResponse({
    status: 200,
    description: 'Review updated successfully',
  })
  @Patch('/:id')
  @AuthPermissions([PERMISSIONS.EDIT_SCRIBE_REVIEW])
  async updateReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateReviewDto: UpdateReviewDto,
  ): Promise<SuccessResponse> {
    return this.reviewService.updateReview(id, updateReviewDto);
  }

  @ApiOperation({ summary: 'Get all scribe session reviews' })
  @Get()
  @AuthPermissions([PERMISSIONS.VIEW_SCRIBE_REVIEWS])
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of reviews to return',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of reviews to skip',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ReviewSortBy,
    description: 'Field to sort by',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: SortOrder,
    description: 'Sort order: ASC or DESC',
  })
  async getAllReviews(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('sortBy') sortBy?: ReviewSortBy,
    @Query('sortOrder') sortOrder: SortOrder = SortOrder.DESC,
  ) {
    return this.reviewService.getAllReviews({
      limit,
      offset,
      sortBy,
      sortOrder,
    });
  }

  @Get('/unread-count')
  @AuthPermissions([PERMISSIONS.VIEW_SCRIBE_REVIEWS])
  @ApiOperation({ summary: 'Get unread scribe session review count' })
  @ApiResponse({
    status: 200,
    description: 'Unread review count retrieved successfully',
  })
  async getUnreadReviewCount(): Promise<{ count: number }> {
    return this.reviewService.getUnreadReviewCount();
  }

  @Get('/:id')
  @AuthPermissions([PERMISSIONS.VIEW_SCRIBE_REVIEW])
  @ApiOperation({ summary: 'Get scribe session review by id' })
  @ApiResponse({
    status: 200,
    description: 'Scribe session review retrieved successfully',
  })
  async getReviewById(@Param('id', ParseUUIDPipe) id: string) {
    return this.reviewService.getReviewById(id);
  }

  @ApiOperation({ summary: 'Get scribe session review messages' })
  @ApiResponse({
    status: 200,
    description: 'Review messages retrieved successfully',
    type: GetReviewMessagesResponseDto,
  })
  @AuthPermissions([PERMISSIONS.VIEW_SCRIBE_REVIEW_THREADS])
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    type: String,
    description: 'Field to sort by (default: createdAt)',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: SortOrder,
  })
  @Get(':reviewId/messages')
  async getReviewMessages(
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('sortBy') sortBy?: string,
    @Query('order') order: SortOrder = SortOrder.ASC,
  ): Promise<GetReviewMessagesResponseDto> {
    return this.reviewService.getReviewMessages(reviewId, {
      limit,
      offset,
      sortBy,
      order,
    });
  }

  @Patch('/:id/mark-read')
  @AuthPermissions([PERMISSIONS.VIEW_SCRIBE_REVIEW])
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
