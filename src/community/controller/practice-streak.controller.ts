import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { PracticeStreakService } from '../service/practice-streak.service';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  GetPracticeStreakQueryDto,
  PracticeStreakResponseDto,
} from '../dto/practice-streak.dto';
import { PracticeStreakGroupBy } from '../type/practice-streak.type';

@ApiTags('Community')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'community/practice-streak',
  version: '1',
})
export class PracticeStreakController {
  constructor(private readonly practiceStreakService: PracticeStreakService) {}

  @Get()
  @AuthPermissions([PERMISSIONS.VIEW_USER_RANK])
  @ApiOperation({
    summary:
      'Get the current user practice-minutes heatmap grouped by day/week/month',
  })
  @ApiResponse({
    status: 200,
    description: 'Practice streak heatmap retrieved successfully',
    type: PracticeStreakResponseDto,
  })
  async getPracticeStreak(
    @Query() query: GetPracticeStreakQueryDto,
    @CurrentUser() user: TokenUser,
  ): Promise<PracticeStreakResponseDto> {
    return this.practiceStreakService.getPracticeStreak(
      user.id,
      user.tenantId,
      query.groupBy ?? PracticeStreakGroupBy.DAY,
      query.from,
      query.to,
    );
  }
}
