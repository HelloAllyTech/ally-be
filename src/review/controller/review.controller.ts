import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
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

@Controller({
  path: 'review',
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
}
