import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsOptional } from 'class-validator';
import { PracticeStreakGroupBy } from '../type/practice-streak.type';

export class GetPracticeStreakQueryDto {
  @ApiPropertyOptional({
    description:
      'Grouping granularity for the heatmap cells. Each cell represents one day, week or month.',
    enum: PracticeStreakGroupBy,
    default: PracticeStreakGroupBy.DAY,
    example: PracticeStreakGroupBy.DAY,
  })
  @IsOptional()
  @IsEnum(PracticeStreakGroupBy)
  groupBy?: PracticeStreakGroupBy = PracticeStreakGroupBy.DAY;

  @ApiPropertyOptional({
    description:
      'Inclusive start date (ISO 8601). Defaults to a sensible window based on groupBy.',
    example: '2026-01-01',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    description: 'Inclusive end date (ISO 8601). Defaults to today.',
    example: '2026-07-10',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class PracticeStreakCellDto {
  @ApiProperty({
    description: 'Start date of the bucket (YYYY-MM-DD).',
    example: '2026-07-10',
  })
  periodStart!: string;

  @ApiProperty({
    description: 'Inclusive end date of the bucket (YYYY-MM-DD).',
    example: '2026-07-10',
  })
  periodEnd!: string;

  @ApiProperty({
    description: 'Practice minutes accumulated in the bucket.',
    example: 12.5,
  })
  minutes!: number;
}

export class PracticeStreakResponseDto {
  @ApiProperty({
    description: 'Grouping granularity applied to the cells.',
    enum: PracticeStreakGroupBy,
  })
  groupBy!: PracticeStreakGroupBy;

  @ApiProperty({
    type: [PracticeStreakCellDto],
    description:
      'Ordered (ascending) list of heatmap cells covering the requested range, with gaps filled as zero.',
  })
  cells!: PracticeStreakCellDto[];

  @ApiProperty({
    description: 'Total practice minutes across the returned range.',
    example: 245.5,
  })
  totalMinutes!: number;

  @ApiProperty({
    description:
      'Current consecutive-active-days streak (days with >= 1 minute practiced), counting up to today.',
    example: 4,
  })
  currentStreak!: number;

  @ApiProperty({
    description: 'Longest consecutive-active-days streak on record.',
    example: 21,
  })
  longestStreak!: number;
}
