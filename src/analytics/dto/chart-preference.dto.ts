import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

import {
  ANALYTICS_BUCKETS,
  ANALYTICS_RANGES,
  AnalyticsBucketParam,
  AnalyticsRange,
} from './platform-analytics.dto';

/**
 * Most charts a reader can reasonably have pinned in one save.
 *
 * The client batches a whole tab's controls into one PUT, so the cap has to clear
 * the largest tab with room to grow — but it must exist, or one request can write
 * an unbounded number of rows.
 */
export const MAX_CHART_PREFERENCES_PER_SAVE = 100;

/** One chart's saved controls. */
export class ChartPreferenceDto {
  @ApiProperty({
    description:
      'Client-owned chart key, namespaced by its tab, e.g. "highlights.practice".',
    example: 'highlights.practice',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, {
    message:
      'chartId must be 1-128 chars of letters, digits, dot, underscore or dash',
  })
  chartId!: string;

  @ApiProperty({
    description: 'Saved window, or null/omitted to fall back to the default.',
    enum: ANALYTICS_RANGES,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range?: AnalyticsRange | null;

  @ApiProperty({
    description: 'Saved grain, or null/omitted to fall back to the default.',
    enum: ANALYTICS_BUCKETS,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsIn(ANALYTICS_BUCKETS)
  bucket?: AnalyticsBucketParam | null;
}

/**
 * Save a batch of chart controls for the calling user.
 *
 * A batch, not one chart per request: a reader who re-ranges three charts while
 * reading should not generate three round trips, and a tab that saves on unmount
 * has exactly one chance to write.
 *
 * The write is an UPSERT per chart and is NOT a replace-all — charts absent from
 * the payload keep whatever they had. That way a client that only knows about the
 * charts on the current tab cannot wipe the saved state of every other tab just
 * by saving.
 */
export class SaveChartPreferencesDto {
  @ApiProperty({
    type: [ChartPreferenceDto],
    description: `Up to ${MAX_CHART_PREFERENCES_PER_SAVE} charts per request.`,
  })
  @IsArray()
  @ArrayMaxSize(MAX_CHART_PREFERENCES_PER_SAVE)
  @ValidateNested({ each: true })
  @Type(() => ChartPreferenceDto)
  preferences!: ChartPreferenceDto[];
}

export class ChartPreferencesResponseDto {
  @ApiProperty({
    type: [ChartPreferenceDto],
    description:
      'Every saved preference for the calling user, across all tabs. A key the ' +
      'client no longer recognises is safe to ignore: chart ids are ' +
      'client-owned, so a stale row can outlive the chart it belonged to.',
  })
  preferences!: ChartPreferenceDto[];
}
