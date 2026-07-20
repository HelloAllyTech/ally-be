import { IsIn, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ANALYTICS_RANGES, AnalyticsRange } from './platform-analytics.dto';

/**
 * DTOs for the tenant-scoped Organization Metrics dashboard (helpline
 * dashboard, tenant admins). The response is deliberately shaped as a
 * `summary` block plus per-metric trends so new organization metrics can be
 * added as extra fields without breaking existing clients.
 */

export class OrganizationMetricsQueryDto {
  @ApiProperty({
    description: 'Time window for the organization metrics',
    enum: ANALYTICS_RANGES,
    default: '30d',
    required: false,
  })
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range?: AnalyticsRange;
}

export class OrganizationMetricsSummaryDto {
  @ApiProperty({
    description: 'Simulations completed across the organization in the window',
  })
  simulationsCompleted!: number;

  @ApiProperty({
    description: 'Users who completed at least one simulation in the window',
  })
  activeUsers!: number;
}

export class OrganizationMetricsTrendPointDto {
  @ApiProperty({ description: 'Bucket start date (ISO yyyy-mm-dd)' })
  bucket!: string;

  @ApiProperty({ description: 'Metric value for this bucket' })
  count!: number;
}

export class OrganizationMetricsResponseDto {
  @ApiProperty({ enum: ANALYTICS_RANGES })
  range!: AnalyticsRange;

  @ApiProperty({ description: 'Bucket granularity (day / week / month)' })
  bucket!: string;

  @ApiProperty({ type: OrganizationMetricsSummaryDto })
  summary!: OrganizationMetricsSummaryDto;

  @ApiProperty({
    type: [OrganizationMetricsTrendPointDto],
    description: 'Simulations completed per bucket (zero-filled)',
  })
  simulationsCompletedTrend!: OrganizationMetricsTrendPointDto[];

  @ApiProperty({
    type: [OrganizationMetricsTrendPointDto],
    description: 'Users with >=1 completed simulation per bucket (zero-filled)',
  })
  activeUsersTrend!: OrganizationMetricsTrendPointDto[];
}
