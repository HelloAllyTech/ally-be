import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches } from 'class-validator';

import { AnalyticsScopingDto } from './platform-analytics.dto';
import { ORG_ACTIVITY_WINDOWS } from '../repository/org-engagement-analytics.repository';

export class OrgEngagementQueryDto {
  @ApiProperty({
    description:
      'Trailing window, in days, for the "orgs active recently" headline. ' +
      'Does not affect the org count or the monthly trend.',
    enum: ORG_ACTIVITY_WINDOWS,
    default: 28,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(ORG_ACTIVITY_WINDOWS as unknown as number[])
  activityDays?: number;

  @ApiProperty({
    description:
      'Accepted for interface consistency and IGNORED: every figure here is a ' +
      'count OF orgs, which a single-org filter cannot narrow to anything ' +
      'meaningful. See `scoping.unscopedSections`.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

/** One month of the org-activity trend. */
export class OrgActivityPointDto {
  @ApiProperty({ description: 'Month start, yyyy-mm-dd' }) month!: string;

  @ApiProperty({ description: 'Orgs with >=1 completed simulation that month' })
  activeOrgs!: number;

  @ApiProperty({ description: 'Orgs that existed by the end of that month' })
  totalOrgs!: number;

  @ApiProperty({
    description: 'activeOrgs / totalOrgs (%); null before any org existed',
    nullable: true,
    type: Number,
  })
  activeSharePct!: number | null;
}

export class OrgEngagementResponseDto {
  @ApiProperty({
    description: 'Non-test, non-deleted orgs on the platform',
  })
  orgs!: number;

  @ApiProperty({
    description: 'The trailing window the headline covers, in days',
  })
  activityDays!: number;

  @ApiProperty({
    description:
      'Orgs with >=1 completed simulation in the trailing `activityDays`.',
  })
  activeOrgs!: number;

  @ApiProperty({
    description:
      'Orgs that existed BEFORE the window opened — the honest denominator. An ' +
      'org signed up three days ago has not had the chance to be inactive for ' +
      '28, and counting it as a miss would make this share fall every time ' +
      'sales closed a deal.',
  })
  eligibleOrgs!: number;

  @ApiProperty({
    description: 'activeOrgs / eligibleOrgs (%); null when none were eligible',
    nullable: true,
    type: Number,
  })
  activeSharePct!: number | null;

  @ApiProperty({
    type: [OrgActivityPointDto],
    description:
      'Monthly trend on a contiguous axis. NOTE the grain differs from the ' +
      'headline: a point is "active in that CALENDAR MONTH", not "active in a ' +
      'trailing window ending there", so the last point and the headline are ' +
      'near neighbours rather than the same number.',
  })
  activityTrend!: OrgActivityPointDto[];

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'Server time the aggregates were computed' })
  computedAt!: string;
}
