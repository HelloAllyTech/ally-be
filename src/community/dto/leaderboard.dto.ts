import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { LeaderboardSortBy, LeaderboardView } from '../type/leaderboard.type';
import { SortOrder } from 'src/common/type/common.type';

export class GetLeaderboardQueryDto {
  @ApiProperty({
    description: 'Time window for the leaderboard',
    enum: LeaderboardView,
    example: LeaderboardView.LAST_WEEK,
  })
  @IsEnum(LeaderboardView)
  window!: LeaderboardView;

  @ApiPropertyOptional({
    description: 'Maximum number of results to return',
  })
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({
    description: 'Number of results to skip for pagination',
  })
  @IsOptional()
  offset?: number;

  @ApiPropertyOptional({
    description: 'Sort by field',
    enum: LeaderboardSortBy,
    example: LeaderboardSortBy.SCORE,
  })
  @IsOptional()
  @IsEnum(LeaderboardSortBy)
  sortBy?: LeaderboardSortBy = LeaderboardSortBy.SCORE;

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: SortOrder,
    example: SortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(SortOrder)
  order?: SortOrder = SortOrder.DESC;
}

export class GetMyRankQueryDto {
  @ApiProperty({
    description: 'Time window for the rank',
    enum: LeaderboardView,
    example: LeaderboardView.LAST_WEEK,
  })
  @IsEnum(LeaderboardView)
  window!: LeaderboardView;
}

export class LeaderboardEntryDto {
  @ApiProperty({ description: 'User ID' })
  userId!: number;

  @ApiProperty({ description: 'User name' })
  name!: string;

  @ApiProperty({ description: 'Profile image URL', nullable: true })
  profileImageUrl?: string;

  @ApiProperty({ description: 'Rank in the leaderboard' })
  rank?: number;

  @ApiProperty({ description: 'Total minutes played in the time window' })
  minutesPlayed!: number;

  @ApiProperty({ description: 'Badge count' })
  badgeCount!: number;
}

export class LeaderboardResponseDto {
  @ApiProperty({
    type: [LeaderboardEntryDto],
    description: 'Leaderboard entries',
  })
  data!: LeaderboardEntryDto[];

  @ApiProperty({ description: 'Time window for the leaderboard' })
  window!: LeaderboardView;

  @ApiProperty({ description: 'Total number of users in the leaderboard' })
  totalCount!: number;
}

export class MyRankResponseDto extends LeaderboardEntryDto {
  @ApiProperty({ description: 'Time window for the rank' })
  window!: LeaderboardView;
}
