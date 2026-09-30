import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches } from 'class-validator';

// Like the changelog feed, out-of-range values are clamped server-side rather
// than rejected: this endpoint is public, and asking for a date past today or
// before the first commit should get the nearest honest answer, not a 400.
export class GetPublicCodeActivityDto {
  @ApiPropertyOptional({
    description:
      'Last day of the window, yyyy-mm-dd (UTC). Defaults to today; clamped to ' +
      '[earliestDate, today].',
    example: '2026-09-30',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'until must be yyyy-mm-dd' })
  until?: string;

  @ApiPropertyOptional({
    description:
      'Days in the window, ending at `until` (default 30, clamped to 1–92)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  days?: number;
}

/** One UTC day, summed across every repo. */
export class CodeActivityDayDto {
  @ApiProperty({
    description: 'The UTC day, yyyy-mm-dd',
    example: '2026-09-15',
  })
  date!: string;

  @ApiProperty({ description: 'Lines added' })
  added!: number;

  @ApiProperty({ description: 'Lines removed, as a positive count' })
  deleted!: number;

  @ApiProperty({
    description:
      'added + deleted. Churn rather than net, as on the admin ship-volume ' +
      'chart: a day that deletes 10k lines did real work.',
  })
  churn!: number;

  @ApiProperty({ description: 'True for today, which is still filling up' })
  partial!: boolean;
}

export class CodeActivityResponseDto {
  @ApiProperty({
    description:
      'Every day from `from` to `until`, oldest first. Dense: a day with no ' +
      'commits is present with zeros, so adjacent cells are adjacent days.',
    type: [CodeActivityDayDto],
  })
  days!: CodeActivityDayDto[];

  @ApiProperty({ description: 'First day in `days`', example: '2026-09-01' })
  from!: string;

  @ApiProperty({ description: 'Last day in `days`', example: '2026-09-30' })
  until!: string;

  @ApiProperty({ description: 'Today, UTC', example: '2026-09-30' })
  today!: string;

  @ApiProperty({
    description: 'The first day there is anything to show; nothing precedes it',
    example: '2025-04-23',
  })
  earliestDate!: string;

  @ApiProperty({ description: 'Whether days before `from` exist to be loaded' })
  hasOlder!: boolean;

  @ApiProperty({
    description:
      'True when at least one repo could not be read for some part of the ' +
      'window and had nothing cached, so the totals shown are LOWER than the ' +
      'truth. Repos are summed, so a missing one shortens every day silently ' +
      'unless this is said on the page.',
  })
  incomplete!: boolean;

  @ApiProperty({ description: 'When this response was assembled' })
  computedAt!: string;
}
