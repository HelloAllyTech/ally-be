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

export class FoundDayDto {
  @ApiProperty({
    description:
      'Calendar day (yyyy-mm-dd, UTC — the clock the sweeps run on).',
  })
  day!: string;

  @ApiProperty({
    description:
      'Distinct top-level findings filed that day, every source and repo together, excluding any since dismissed or rejected. A quiet day is a real 0.',
  })
  filed!: number;

  @ApiProperty({
    nullable: true,
    description:
      'Mean of `filed` over this day and the six before it, so the nightly spikes read as a trend. ' +
      'Null for the first six days of the window, where there are not seven days to average.',
  })
  rollingAvg7!: number | null;
}

export class BugAgentPerformancePrecisionDto {
  @ApiProperty({ type: [PrecisionWeekDto] }) weekly!: PrecisionWeekDto[];
  @ApiProperty({ type: [SourceAccuracyDto] }) bySource!: SourceAccuracyDto[];
}

/**
 * The goal numbers (OPP-0778). Bug Hunter's goal is to find a bug before any
 * staff member or live user does, so these say how often it did, how often a
 * bug got past a sweep that had read the code, and how long a found bug took
 * to fix.
 */
export class GoalWeekDto {
  @ApiProperty() week!: string;
  @ApiProperty({
    description:
      'Bugs people reported this week that were real (not declined as duplicate, not a bug or wrong repo). Every one is a bug Bug Hunter did not find first.',
  })
  humanReports!: number;
  @ApiProperty({
    description:
      "Real bugs Bug Hunter's own senses filed this week (not declined as finder error).",
  })
  agentBugs!: number;
  @ApiProperty({
    nullable: true,
    description:
      'agentBugs / (agentBugs + humanReports): the share of this week’s real bugs Bug Hunter found rather than a person. Null when nothing was found by anyone.',
  })
  firstFinderShare!: number | null;
  @ApiProperty({
    description:
      'Human reports whose repo a sweep had completed within the previous 7 days — the bug sat in code Bug Hunter had read and passed.',
  })
  escapes!: number;
  @ApiProperty({ nullable: true, description: 'escapes / humanReports.' })
  escapeRate!: number | null;
  @ApiProperty({
    nullable: true,
    description:
      'Median hours from a finding being filed to its fix merging, for fixes merged this week.',
  })
  timeToFixHoursMedian!: number | null;
}

export class GoalWindowDto {
  @ApiProperty() humanReports!: number;
  @ApiProperty() agentBugs!: number;
  @ApiProperty({ nullable: true }) firstFinderShare!: number | null;
  @ApiProperty() escapes!: number;
  @ApiProperty({ nullable: true }) escapeRate!: number | null;
  @ApiProperty({ nullable: true }) timeToFixHoursMedian!: number | null;
  @ApiProperty({
    type: Object,
    description:
      'Why people found bugs first, over the whole window: counts per miss reason from the miss classifier (no_sense, sense_missed, detected_declined, detected_not_fixed, not_a_miss) plus unclassified.',
  })
  missReasons!: Record<string, number>;
}

export class BugAgentGoalDto {
  @ApiProperty({ type: [GoalWeekDto] }) weekly!: GoalWeekDto[];
  @ApiProperty({ type: GoalWindowDto }) window!: GoalWindowDto;
}

export class BugAgentPerformanceResponseDto {
  @ApiProperty({ type: BugAgentGoalDto })
  goal!: BugAgentGoalDto;

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

  @ApiProperty({
    type: [FoundDayDto],
    description:
      'Bugs found per day across all repos, oldest first, gap-filled — the one series on this ' +
      'tab bucketed by day rather than week, because its job is to show the daily count falling.',
  })
  found!: FoundDayDto[];

  @ApiProperty({ type: AnalyticsWindowDto })
  window!: AnalyticsWindowDto;

  @ApiProperty() computedAt!: string;
}
