import { IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AnalyticsScopingDto } from './platform-analytics.dto';

export class LearnerKpisQueryDto {
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

export class LearnerKpisSummaryDto {
  @ApiProperty({
    description:
      'LEARNER-role accounts created, all-time (sum of signupsByMonth)',
  })
  totalLearners!: number;

  @ApiProperty({
    description:
      'Distinct LEARNER-role accounts with >=1 completed session, all-time',
  })
  activeLearners!: number;

  @ApiProperty({
    description:
      'Completed sessions attributed to LEARNER-role accounts, all-time',
  })
  totalCompletedSessions!: number;
}

export class LearnerSignupPointDto {
  @ApiProperty({ description: 'Calendar month start (yyyy-mm-dd)' })
  month!: string;

  @ApiProperty({ description: 'New LEARNER-role accounts created that month' })
  newLearners!: number;

  @ApiProperty({
    description: 'LEARNER-role accounts created by the end of that month',
  })
  cumulativeLearners!: number;
}

export class LearnerKpisResponseDto {
  @ApiProperty({ type: LearnerKpisSummaryDto })
  summary!: LearnerKpisSummaryDto;

  @ApiProperty({
    type: [LearnerSignupPointDto],
    description:
      'All-time monthly signups — the LEARNER-scoped "new users" trend',
  })
  signupsByMonth!: LearnerSignupPointDto[];

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'ISO timestamp this response was computed at' })
  computedAt!: string;
}
