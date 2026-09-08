import { ApiProperty } from '@nestjs/swagger';

import {
  ANALYTICS_BUCKETS,
  ANALYTICS_RANGES,
  AnalyticsBucketParam,
  AnalyticsRange,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';
import {
  CODING_AGENT_LABELS,
  CODING_AGENTS,
} from '../repository/coding-agent-cost-analytics.repository';

export class CodingAgentCostQueryDto extends AnalyticsWindowQueryDto {}

/** Dollar amount keyed by agent — `{ 'bug-hunter': 12.3, 'builder': 45.6 }`. */
export class CodingAgentCostAmountDto {
  @ApiProperty({ description: "Bug Hunter's spend" })
  'bug-hunter'!: number;

  @ApiProperty({ description: "Builder's spend" })
  builder!: number;
}

/**
 * One bucket of the two agents' cost trend.
 *
 * Gap-filled to a contiguous bucket axis — a quiet day is a real zero (no
 * calls means no spend), not a missing point, same rule
 * `RoleplayCostResponseDto.points` follows.
 */
export class CodingAgentCostPointDto {
  @ApiProperty({ description: 'Bucket start, yyyy-mm-dd' }) bucket!: string;

  @ApiProperty({ type: CodingAgentCostAmountDto })
  costUsd!: CodingAgentCostAmountDto;

  @ApiProperty({ type: CodingAgentCostAmountDto, description: 'Call counts' })
  calls!: CodingAgentCostAmountDto;
}

/**
 * One (agent, model) total for the whole selected window — the per-model
 * breakdown underneath the trend. Not bucketed: this answers "where does the
 * money go", which does not need a time axis the way "is it going up" does.
 */
export class CodingAgentModelBreakdownDto {
  @ApiProperty({ enum: CODING_AGENTS }) agent!: string;

  @ApiProperty() model!: string;

  @ApiProperty({ description: 'Whole-window spend on this model, USD' })
  costUsd!: number;

  @ApiProperty({ description: 'Whole-window call count' })
  calls!: number;

  @ApiProperty({
    description:
      'False when this model has no pricing entry — its calls contribute ' +
      '$0, so costUsd understates real spend for this row.',
  })
  priced!: boolean;
}

export class CodingAgentCostResponseDto {
  @ApiProperty({ enum: ANALYTICS_RANGES }) range!: AnalyticsRange;

  @ApiProperty({ enum: ANALYTICS_BUCKETS }) bucket!: AnalyticsBucketParam;

  @ApiProperty({ type: AnalyticsWindowDto }) window!: AnalyticsWindowDto;

  @ApiProperty({
    description: 'Agent key -> admin-facing label',
    example: CODING_AGENT_LABELS,
    type: Object,
  })
  agentLabels!: Record<string, string>;

  @ApiProperty({ type: [CodingAgentCostPointDto] })
  points!: CodingAgentCostPointDto[];

  @ApiProperty({ type: [CodingAgentModelBreakdownDto] })
  modelBreakdown!: CodingAgentModelBreakdownDto[];

  @ApiProperty({
    type: CodingAgentCostAmountDto,
    description: 'Whole-window spend',
  })
  totalCostUsd!: CodingAgentCostAmountDto;

  @ApiProperty({
    description: 'Whole-window calls with no pricing entry, across both agents',
  })
  unpricedCalls!: number;

  @ApiProperty({
    description:
      'Every figure here is an ESTIMATE: cost is derived at read time from a ' +
      'hand-maintained pricing table, ignores prompt-cache discounts and ' +
      'negotiated rates, and is not a billed amount.',
  })
  estimateNote!: string;

  @ApiProperty({ description: 'Server time the aggregates were computed' })
  computedAt!: string;
}
