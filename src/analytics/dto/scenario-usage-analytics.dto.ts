import { IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AnalyticsScopingDto } from './platform-analytics.dto';

export class ScenarioUsageQueryDto {
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

export class ScenarioUsageRowDto {
  @ApiProperty() scenarioId!: number;
  @ApiProperty() title!: string;
  @ApiProperty({ description: 'Completed sessions, all-time' })
  sessionCount!: number;
}

export class ScenarioUsageResponseDto {
  @ApiProperty({
    type: [ScenarioUsageRowDto],
    description:
      'Top scenarios by all-time completed-session count, most-used first',
  })
  mostUsed!: ScenarioUsageRowDto[];

  @ApiProperty({
    type: [ScenarioUsageRowDto],
    description:
      'Bottom scenarios among those with >=1 completed session, least-used first',
  })
  leastUsed!: ScenarioUsageRowDto[];

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'ISO timestamp this response was computed at' })
  computedAt!: string;
}
