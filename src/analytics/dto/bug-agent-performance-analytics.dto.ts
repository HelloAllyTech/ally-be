import { ApiProperty } from '@nestjs/swagger';

import {
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';

export class BugAgentPerformanceQueryDto extends AnalyticsWindowQueryDto {}

export class PrecisionWeekDto {
  @ApiProperty({ description: 'Calendar week start (yyyy-mm-dd, UTC Monday).' })
  week!: string;

  @ApiProperty({
    nullable: true,
    description:
      '1 - finderErrors/judged for findings FILED this week. Null when nothing filed this week has been judged yet.',
  })
  accuracy!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      "reversed/finderErrors for this week's filed findings. Expect recent weeks to read null or low — a decline needs 30+ days before it can be proven wrong, so this lags by design.",
  })
  reversalRate!: number | null;

  @ApiProperty() filed!: number;
  @ApiProperty({
    description:
      'Findings somebody actually ruled on — the denominator of accuracy.',
  })
  judged!: number;
}

export class SourceAccuracyDto {
  @ApiProperty() source!: string;
  @ApiProperty({ nullable: true }) accuracy!: number | null;
  @ApiProperty() filed!: number;
  @ApiProperty() judged!: number;
}

export class ThroughputWeekDto {
  @ApiProperty() week!: string;

  @ApiProperty({
    nullable: true,
    description:
      'merged / approved for findings filed this week — does an approved fix actually land?',
  })
  approvedToMergedRate!: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Escalated events this week / fix-session runs this week.',
  })
  escalationRate!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Gemini-to-Claude fallbacks this week / fix-session runs this week.',
  })
  fallbackRate!: number | null;

  @ApiProperty() approved!: number;
  @ApiProperty() merged!: number;
  @ApiProperty() fixSessionRuns!: number;
  @ApiProperty() escalations!: number;
  @ApiProperty() fallbacks!: number;
}

export class SpeedWeekDto {
  @ApiProperty() week!: string;
  @ApiProperty({ nullable: true }) filedToDecidedMedianHours!: number | null;
  @ApiProperty({ nullable: true }) filedToMergedMedianHours!: number | null;
  @ApiProperty({ nullable: true }) mergedToReleasedMedianHours!: number | null;
  @ApiProperty({
    nullable: true,
    description:
      'Dispatch to first reported event — isolates runner/queue delay from actual fix time, which filedToMerged cannot.',
  })
  queueToStartMedianHours!: number | null;
}

export class CostWeekDto {
  @ApiProperty() week!: string;
  @ApiProperty({
    description: 'All Bug Hunter spend this week (sweeps + fix sessions).',
  })
  totalUsd!: number;
  @ApiProperty({ nullable: true }) costPerMergedFixUsd!: number | null;
  @ApiProperty() merged!: number;
}

export class ReliabilityWeekDto {
  @ApiProperty() week!: string;
  @ApiProperty({
    nullable: true,
    description: 'completed / (completed + failed) runs this week.',
  })
  completionRate!: number | null;
  @ApiProperty({ nullable: true }) fallbackRate!: number | null;
  @ApiProperty({
    nullable: true,
    description:
      'Fixes that shipped this week and have since come back, over fixes merged this week — will read null/low for recent weeks by the same lag reversalRate has.',
  })
  regressionRate!: number | null;
  @ApiProperty() runs!: number;
  @ApiProperty() completed!: number;
  @ApiProperty() failed!: number;
}

export class BugAgentPerformancePrecisionDto {
  @ApiProperty({ type: [PrecisionWeekDto] }) weekly!: PrecisionWeekDto[];
  @ApiProperty({ type: [SourceAccuracyDto] }) bySource!: SourceAccuracyDto[];
}

export class BugAgentPerformanceResponseDto {
  @ApiProperty({ type: BugAgentPerformancePrecisionDto })
  precision!: BugAgentPerformancePrecisionDto;

  @ApiProperty({ type: [ThroughputWeekDto] })
  throughput!: ThroughputWeekDto[];

  @ApiProperty({ type: [SpeedWeekDto] })
  speed!: SpeedWeekDto[];

  @ApiProperty({ type: [CostWeekDto] })
  cost!: CostWeekDto[];

  @ApiProperty({ type: [ReliabilityWeekDto] })
  reliability!: ReliabilityWeekDto[];

  @ApiProperty({ type: AnalyticsWindowDto })
  window!: AnalyticsWindowDto;

  @ApiProperty() computedAt!: string;
}
