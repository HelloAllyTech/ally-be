import { ApiProperty } from '@nestjs/swagger';

import {
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';

export class FixSessionEngineCostQueryDto extends AnalyticsWindowQueryDto {}

export class FixSessionEngineCostDto {
  @ApiProperty({
    description:
      'Which CLI ran the session — "claude-code" or "gemini" — whatever the run itself reported.',
  })
  engine!: string;

  @ApiProperty({
    description:
      'Mean totalTokenCostUsd across this engine\'s COMPLETED fix sessions in the window — the same figure the run-history table\'s own "Est. cost" column shows, averaged.',
  })
  avgCostUsd!: number;

  @ApiProperty({
    description:
      'How many completed fix sessions the average is over. Read this alongside avgCostUsd, not instead of it — a handful of sessions is not yet a trend.',
  })
  sessionCount!: number;
}

export class FixSessionEngineCostResponseDto {
  @ApiProperty({ type: [FixSessionEngineCostDto] })
  byEngine!: FixSessionEngineCostDto[];

  @ApiProperty({ type: AnalyticsWindowDto })
  window!: AnalyticsWindowDto;

  @ApiProperty() computedAt!: string;
}
