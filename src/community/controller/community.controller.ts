import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { LeaderboardService } from '../service/leaderboard.service';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  GetLeaderboardQueryDto,
  GetMyRankQueryDto,
  LeaderboardResponseDto,
  MyRankResponseDto,
} from '../dto/leaderboard.dto';

@ApiTags('Community')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'community/leaderboard',
  version: '1',
})
export class CommunityController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get()
  @AuthPermissions([PERMISSIONS.VIEW_COMMUNITY_LEADERBOARD])
  @ApiOperation({ summary: 'Get leaderboard for the current tenant' })
  @ApiResponse({
    status: 200,
    description: 'Leaderboard retrieved successfully',
    type: LeaderboardResponseDto,
  })
  async getLeaderboard(
    @Query() query: GetLeaderboardQueryDto,
    @CurrentUser() user: TokenUser,
  ): Promise<LeaderboardResponseDto> {
    return this.leaderboardService.getLeaderboard(user.tenantId, query.window, {
      limit: query?.limit,
      offset: query?.offset,
      sortBy: query?.sortBy,
      order: query?.order,
    });
  }

  @Get('my-rank')
  @AuthPermissions([PERMISSIONS.VIEW_USER_RANK])
  @ApiOperation({ summary: 'Get current user rank in the leaderboard' })
  @ApiResponse({
    status: 200,
    description: 'User rank retrieved successfully',
    type: MyRankResponseDto,
  })
  async getMyRank(
    @Query() query: GetMyRankQueryDto,
    @CurrentUser() user: TokenUser,
  ): Promise<MyRankResponseDto | null> {
    return this.leaderboardService.getMyRank(
      user.id,
      user.tenantId,
      query.window,
    );
  }
}
