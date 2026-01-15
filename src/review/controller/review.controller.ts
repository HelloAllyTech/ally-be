import {
  Body,
  Controller,
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
import {
  CreateReviewDto,
  CreateReviewResponseDto,
} from '../dto/create-review.dto';
import { ReviewService } from '../service/review.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { ReviewThreadsResponseDto } from '../dto/review-threads.dto';
import { SortOrder, SuccessResponse } from 'src/common/type/common.type';
import { UpdateReviewStatusDto } from '../dto/update-review-status.dto';
import { ReviewSortBy } from '../type/review.type';
import { ReviewsListResponseDto } from '../dto/get-all-review-response.dto';
import { GetReviewResponseDto } from '../dto/get-review-response.dto';

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

  @ApiOperation({ summary: 'Change review status' })
  @ApiResponse({
    status: 200,
    description: 'Review status updated successfully',
  })
  @Patch('/:id')
  @AuthPermissions([PERMISSIONS.EDIT_REVIEW])
  async updateReviewStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateReviewStatusDto: UpdateReviewStatusDto,
  ): Promise<SuccessResponse> {
    return this.reviewService.updateReviewStatus(id, updateReviewStatusDto);
  }

  @ApiOperation({ summary: 'Get all reviews' })
  @Get()
  @AuthPermissions([PERMISSIONS.VIEW_REVIEWS])
  @ApiResponse({
    status: 200,
    description: 'List of reviews retrieved successfully',
    type: CreateReviewResponseDto,
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
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
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
  async getReviewById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GetReviewResponseDto> {
    return this.reviewService.getReviewById(id);
  }

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
    return this.reviewService.getReviewThreads(reviewId, { limit, offset });
  }
}
