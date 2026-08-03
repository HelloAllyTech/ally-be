import { IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AnalyticsScopingDto } from './platform-analytics.dto';

export class OrgSessionDistributionQueryDto {
  @ApiProperty({
    description: 'Narrow to a single tenant (uuid or code)',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

export class OrgDistributionBandDto {
  @ApiProperty() label!: string;
  @ApiProperty({
    description: 'Orgs whose all-time average falls in this band',
  })
  orgs!: number;
}

export class OrgDistributionSectionDto {
  @ApiProperty({
    description:
      'Orgs with >=1 learner — the population this distribution is drawn from',
  })
  totalOrgs!: number;

  @ApiProperty({
    type: [OrgDistributionBandDto],
    description:
      'One entry per band, lowest first. Does not include the zero band ' +
      '(orgs whose learners have no activity at all) — that is a residual ' +
      'of totalOrgs, computed by the client as totalOrgs minus the sum of ' +
      'these counts, so the two always add up to the stated denominator.',
  })
  bands!: OrgDistributionBandDto[];

  @ApiProperty({
    description:
      'Below this many orgs, the distribution is suppressed (bands empty) ' +
      'rather than shown over a population too small to band meaningfully.',
  })
  minGroupSize!: number;

  @ApiProperty({
    description:
      'False when totalOrgs is below minGroupSize — bands are empty in that case',
  })
  shown!: boolean;
}

export class OrgSessionDistributionResponseDto {
  @ApiProperty({
    type: OrgDistributionSectionDto,
    description: 'Orgs bucketed by all-time average minutes-played per learner',
  })
  avgMinutesPerLearner!: OrgDistributionSectionDto;

  @ApiProperty({
    type: OrgDistributionSectionDto,
    description:
      'Orgs bucketed by all-time average completed sessions per learner',
  })
  avgSessionsPerLearner!: OrgDistributionSectionDto;

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'ISO timestamp this response was computed at' })
  computedAt!: string;
}
