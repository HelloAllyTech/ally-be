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
import {
  CreateReviewDto,
  CreateReviewResponseDto,
} from '../dto/create-review.dto';
import { ReviewService } from '../service/review.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { SortOrder, SuccessResponse } from 'src/common/type/common.type';
import { UpdateReviewDto } from '../dto/update-review.dto';
import { ReviewSortBy } from '../type/review.type';
import { ReviewsListResponseDto } from '../dto/get-all-review-response.dto';
import { GetReviewResponseDto } from '../dto/get-review-response.dto';
import { GetReviewMessagesResponseDto } from '../dto/review-messages-response.dto';

@Controller({
  path: 'reviews',
  version: '1',
})
@ApiBearerAuth()
@ApiSecurity('access-token')
@ApiTags('Review')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @ApiOperation({ summary: 'Create review' })
  @ApiResponse({
    status: 201,
    description: 'Review created successfully',
    type: CreateReviewResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_REVIEW])
  @Post()
  async createReview(
    @Body() createReviewDto: CreateReviewDto,
  ): Promise<CreateReviewResponseDto> {
    return this.reviewService.createReview(createReviewDto);
  }

  @ApiOperation({ summary: 'Update review status or note' })
  @ApiResponse({
    status: 200,
    description: 'Review updated successfully',
  })
  @Patch('/:id')
  @AuthPermissions([PERMISSIONS.EDIT_REVIEW])
  async updateReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateReviewDto: UpdateReviewDto,
  ): Promise<SuccessResponse> {
    return this.reviewService.updateReview(id, updateReviewDto);
  }

  @ApiOperation({ summary: 'Get all reviews' })
  @Get()
  @AuthPermissions([PERMISSIONS.VIEW_REVIEWS])
  @ApiResponse({
    status: 200,
    description: 'List of reviews retrieved successfully',
    type: ReviewsListResponseDto,
  })
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
  ): Promise<ReviewsListResponseDto> {
    return this.reviewService.getAllReviews({
      limit,
      offset,
      sortBy,
      sortOrder,
    });
  }

  @Get('/:id')
  @AuthPermissions([PERMISSIONS.VIEW_REVIEW])
  @ApiOperation({ summary: 'Get review by ID' })
  @ApiResponse({
    status: 200,
    description: 'Review retrieved successfully',
    type: GetReviewResponseDto,
  })
  async getReviewById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GetReviewResponseDto> {
    return this.reviewService.getReviewById(id);
  }

  @ApiOperation({ summary: 'Get review messages' })
  @ApiResponse({
    status: 200,
    description: 'Review messages retrieved successfully',
    type: GetReviewMessagesResponseDto,
  })
  @AuthPermissions([PERMISSIONS.VIEW_REVIEW_THREADS])
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of messages to return',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of messages to skip',
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
    description: 'Sort order (default: ASC)',
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
}
