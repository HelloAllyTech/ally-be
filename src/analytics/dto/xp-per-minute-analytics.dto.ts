import { ApiProperty } from '@nestjs/swagger';

import {
  ANALYTICS_BUCKETS,
  AnalyticsBucketParam,
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';
import { XP_SOURCE_GROUPS } from '../constants/xp-per-minute.constants';

/** Standard window params; defaults to `range=all`, monthly buckets. */
export class XpPerMinuteQueryDto extends AnalyticsWindowQueryDto {}

/**
 * One value per XP source group, in `XP_SOURCE_GROUPS` order. Used for both XP
 * totals and XP-per-minute, so the stacked bars and the table read one shape.
 */
export class XpSourceGroupsDto {
  @ApiProperty({ nullable: true, type: Number }) roleplay!: number | null;
  @ApiProperty({ nullable: true, type: Number }) tracks!: number | null;
  @ApiProperty({ nullable: true, type: Number }) community!: number | null;
  @ApiProperty({ nullable: true, type: Number }) consistency!: number | null;
  @ApiProperty({ nullable: true, type: Number }) other!: number | null;
}

export class XpSourceGroupDefDto {
  @ApiProperty({ enum: XP_SOURCE_GROUPS }) key!: string;
  @ApiProperty() label!: string;
  @ApiProperty() description!: string;
}

/** XP and roleplay minutes for one bucket, or for the whole window. */
export class XpPerMinuteTotalsDto {
  @ApiProperty({ description: 'XP awarded, every source' })
  xp!: number;

  @ApiProperty({
    description:
      'Roleplay minutes practised (user_daily_scores) — the same figure as ' +
      'the Roleplay Minutes chart',
  })
  minutes!: number;

  @ApiProperty({
    description:
      'The headline: `xp / minutes`. Null when no roleplay minutes were ' +
      'recorded — a ratio with no denominator is not zero.',
    nullable: true,
    type: Number,
  })
  xpPerMinute!: number | null;

  @ApiProperty({
    description:
      'Roleplay-sourced XP as a share of all XP, 0–100. Null when no XP was ' +
      'awarded.',
    nullable: true,
    type: Number,
  })
  roleplaySharePct!: number | null;

  @ApiProperty({
    type: XpSourceGroupsDto,
    description: '`xp` split by source group; sums to `xp`',
  })
  xpBySource!: XpSourceGroupsDto;

  @ApiProperty({
    type: XpSourceGroupsDto,
    description:
      'Each source over the same roleplay minutes, so the stack sums to ' +
      '`xpPerMinute`. All null when minutes are zero.',
  })
  perMinuteBySource!: XpSourceGroupsDto;
}

export class XpPerMinutePointDto extends XpPerMinuteTotalsDto {
  @ApiProperty({ description: 'Bucket start, yyyy-mm-dd' }) bucket!: string;
}

export class XpPerMinuteResponseDto {
  @ApiProperty({ enum: ANALYTICS_BUCKETS }) bucket!: AnalyticsBucketParam;

  @ApiProperty({ type: AnalyticsWindowDto }) window!: AnalyticsWindowDto;

  @ApiProperty({
    type: [XpSourceGroupDefDto],
    description: 'Source groups in stack order, bottom first',
  })
  sources!: XpSourceGroupDefDto[];

  @ApiProperty({
    type: [XpPerMinutePointDto],
    description:
      'Gap-filled to a contiguous axis. XP and minutes are real zeros in a ' +
      'quiet bucket; ratios are null there.',
  })
  points!: XpPerMinutePointDto[];

  @ApiProperty({
    type: XpPerMinuteTotalsDto,
    description:
      'Whole-window figures — total XP over total minutes, never an average ' +
      'of the per-bucket ratios.',
  })
  overall!: XpPerMinuteTotalsDto;

  @ApiProperty({ type: AnalyticsScopingDto }) scoping!: AnalyticsScopingDto;

  @ApiProperty() computedAt!: string;
}
