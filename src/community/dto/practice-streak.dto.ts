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

export class StreakPreviousRunDto {
  @ApiProperty({
    description:
      'Length in days of the most recent run that has already ended.',
    example: 12,
  })
  days!: number;

  @ApiProperty({
    description: 'Last active day of that run (YYYY-MM-DD).',
    example: '2026-08-05',
  })
  endedOn!: string;

  @ApiProperty({
    description: 'Whole days between that run ending and today. Always >= 1.',
    example: 3,
  })
  daysSinceEnded!: number;
}

export class StreakMilestoneDto {
  @ApiProperty({
    description: 'Streak length in days that unlocks this badge.',
    example: 7,
  })
  days!: number;

  @ApiProperty({ description: 'Badge id.' })
  badgeId!: string;

  @ApiProperty({ description: 'Badge name.', example: 'Week One' })
  badgeName!: string;

  @ApiProperty({
    description: 'Badge artwork URL, when the badge has one.',
    nullable: true,
    example: null,
  })
  badgeImageUrl!: string | null;

  @ApiProperty({
    description: 'Days still to go before the badge unlocks. Always >= 1.',
    example: 4,
  })
  daysRemaining!: number;

  @ApiProperty({
    description:
      'True when the user already holds this badge from an earlier run, so the UI can phrase it as a re-earn.',
    example: false,
  })
  alreadyEarned!: boolean;
}

/**
 * Everything the UI needs to render streak state, without the heatmap cells.
 * The full endpoint extends this; `/summary` returns it on its own.
 */
export class PracticeStreakSummaryDto {
  @ApiProperty({
    description:
      'IANA timezone whose calendar day defines "today" for the streak. The day the streak resets on.',
    example: 'Asia/Kolkata',
  })
  businessTimezone!: string;

  @ApiProperty({
    description: "Today's date in the business timezone (YYYY-MM-DD).",
    example: '2026-08-09',
  })
  today!: string;

  @ApiProperty({
    description: 'Whether the user has practised at all today.',
    example: true,
  })
  practicedToday!: boolean;

  @ApiProperty({
    description:
      'Whether today already counts toward the streak, i.e. at least the active-day minimum has been practised. This — not the daily goal — is what protects the streak.',
    example: true,
  })
  streakSecuredToday!: boolean;

  @ApiProperty({
    description: 'Practice minutes accumulated today.',
    example: 4.5,
  })
  minutesToday!: number;

  @ApiProperty({
    description:
      'Tenant-configured daily practice goal in minutes. Defaults to the active-day minimum, in which case it carries no extra meaning and the UI should not show it as a separate target.',
    example: 1,
  })
  dailyGoalMinutes!: number;

  @ApiProperty({
    description:
      'Minutes still needed to reach the daily goal. Never negative.',
    example: 0,
  })
  minutesToGoal!: number;

  @ApiProperty({
    description:
      'True when the user has a live streak that today has not yet secured.',
    example: false,
  })
  atRisk!: boolean;

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

  @ApiProperty({
    description:
      'First day of the current streak (YYYY-MM-DD); null when there is no current streak.',
    nullable: true,
    example: '2026-08-06',
  })
  streakStartDate!: string | null;

  @ApiProperty({
    description:
      'Most recent day with any qualifying practice (YYYY-MM-DD); null when the user has never practised.',
    nullable: true,
    example: '2026-08-09',
  })
  lastActiveDate!: string | null;

  @ApiProperty({
    type: StreakPreviousRunDto,
    nullable: true,
    description:
      'The most recent run that is not the current one, for "your best recent run was N days" framing after a streak breaks. Null when there is no earlier run.',
  })
  previousRun!: StreakPreviousRunDto | null;

  @ApiProperty({
    type: StreakMilestoneDto,
    nullable: true,
    description:
      "Next streak badge the user is working toward, derived from the tenant's configured badges. Null when no threshold sits above the current streak — the UI must then hide the milestone rather than inventing one.",
  })
  nextMilestone!: StreakMilestoneDto | null;

  @ApiProperty({
    description:
      "What today's practice did to the streak. PENDING means today has not yet been secured — which is also what a client sees while the session-end write is still in flight.",
    enum: ['STARTED', 'EXTENDED', 'PENDING'],
    example: 'EXTENDED',
  })
  streakEventToday!: 'STARTED' | 'EXTENDED' | 'PENDING';
}

export class PracticeStreakResponseDto extends PracticeStreakSummaryDto {
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
}
