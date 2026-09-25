import { ApiProperty } from '@nestjs/swagger';

import {
  ANALYTICS_BUCKETS,
  AnalyticsBucketParam,
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';
import { SESSION_COST_COMPONENTS } from '../constants/session-cost.constants';

export class RoleplaySessionCostQueryDto extends AnalyticsWindowQueryDto {}

/**
 * One value per session-cost component, in `SESSION_COST_COMPONENTS` order.
 * Used for both USD totals and USD-per-minute, so the stacked bars and the
 * table read from one shape.
 */
export class SessionCostComponentsDto {
  @ApiProperty({ nullable: true, type: Number }) dialogue!: number | null;
  @ApiProperty({ nullable: true, type: Number }) stt!: number | null;
  @ApiProperty({ nullable: true, type: Number }) tts!: number | null;
  @ApiProperty({ nullable: true, type: Number }) fillers!: number | null;
  @ApiProperty({ nullable: true, type: Number }) events!: number | null;
  @ApiProperty({ nullable: true, type: Number }) coaching!: number | null;
  @ApiProperty({ nullable: true, type: Number }) debrief!: number | null;
}

export class SessionCostComponentDefDto {
  @ApiProperty({ enum: SESSION_COST_COMPONENTS }) key!: string;
  @ApiProperty() label!: string;
  @ApiProperty() description!: string;
}

/** Cost and minutes for a set of sessions — one bucket, or the whole window. */
export class RoleplaySessionCostTotalsDto {
  @ApiProperty({ description: 'Roleplay sessions started, any length' })
  sessions!: number;

  @ApiProperty({ description: 'Minutes those sessions ran, net of pauses' })
  minutes!: number;

  @ApiProperty({ description: 'AI spend to deliver those sessions, USD' })
  costUsd!: number;

  @ApiProperty({
    description:
      'The headline: `costUsd / minutes`. Null when no minutes were recorded — ' +
      'a ratio with no denominator is not zero.',
    nullable: true,
    type: Number,
  })
  costPerMinuteUsd!: number | null;

  @ApiProperty({
    description: '`costUsd / sessions`; null with no sessions',
    nullable: true,
    type: Number,
  })
  costPerSessionUsd!: number | null;

  @ApiProperty({
    type: SessionCostComponentsDto,
    description: '`costUsd` split by component; sums to `costUsd`',
  })
  costByComponent!: SessionCostComponentsDto;

  @ApiProperty({
    type: SessionCostComponentsDto,
    description:
      'Each component over the same minutes, so the stack sums to ' +
      '`costPerMinuteUsd`. All null when minutes are zero.',
  })
  perMinuteByComponent!: SessionCostComponentsDto;

  @ApiProperty({
    description:
      'Spend tagged to these sessions that is NOT delivery — actor evaluation ' +
      'and judges. Reported, never folded into `costUsd`.',
  })
  excludedCostUsd!: number;

  @ApiProperty({
    description:
      'Delivery calls with no pricing entry. They add $0, so `costUsd` ' +
      'understates spend whenever this is non-zero.',
  })
  unpricedCalls!: number;
}

export class RoleplaySessionCostPointDto extends RoleplaySessionCostTotalsDto {
  @ApiProperty({ description: 'Bucket start, yyyy-mm-dd' }) bucket!: string;

  @ApiProperty({
    description:
      'True when the bucket starts before `fullCoverageFrom` (or full coverage ' +
      'has not been reached yet): sessions in it ran before every delivery ' +
      'call was logged, so its cost is an UNDERSTATEMENT.',
  })
  partial!: boolean;
}

export class RoleplaySessionCostResponseDto {
  @ApiProperty({ enum: ANALYTICS_BUCKETS }) bucket!: AnalyticsBucketParam;

  @ApiProperty({ type: AnalyticsWindowDto }) window!: AnalyticsWindowDto;

  @ApiProperty({
    type: [SessionCostComponentDefDto],
    description: 'Components in stack order, bottom first',
  })
  components!: SessionCostComponentDefDto[];

  @ApiProperty({
    type: [RoleplaySessionCostPointDto],
    description:
      'Gap-filled to a contiguous axis. Costs are real zeros in a quiet bucket; ' +
      'ratios are null there.',
  })
  points!: RoleplaySessionCostPointDto[];

  @ApiProperty({
    type: RoleplaySessionCostTotalsDto,
    description:
      'Whole-window figures from the raw rows — total cost over total minutes, ' +
      'never an average of the per-bucket ratios.',
  })
  overall!: RoleplaySessionCostTotalsDto;

  @ApiProperty({
    description:
      'When every delivery call began being logged against its session ' +
      '(ISO timestamp), measured from the data. Null until both the live ' +
      'session and the debrief have produced a fully-tagged row.',
    nullable: true,
    type: String,
  })
  fullCoverageFrom!: string | null;

  @ApiProperty({ description: 'What `partial` means, for the card caption' })
  coverageNote!: string;

  @ApiProperty() estimateNote!: string;

  @ApiProperty({ type: AnalyticsScopingDto }) scoping!: AnalyticsScopingDto;

  @ApiProperty() computedAt!: string;
}

/** One priced group of a single session's usage. */
export class SessionCostLineDto {
  @ApiProperty() task!: string;

  @ApiProperty({
    description: 'Delivery component; null for analysis spend (excluded)',
    nullable: true,
    enum: SESSION_COST_COMPONENTS,
  })
  component!: string | null;

  @ApiProperty() service!: string;
  @ApiProperty() provider!: string;
  @ApiProperty() model!: string;
  @ApiProperty() calls!: number;
  @ApiProperty() promptTokens!: number;
  @ApiProperty() completionTokens!: number;
  @ApiProperty() audioMs!: number;
  @ApiProperty() characters!: number;
  @ApiProperty() costUsd!: number;

  @ApiProperty({ description: 'False when no pricing entry exists ($0)' })
  priced!: boolean;
}

/** The cost of delivering ONE roleplay session, itemised. */
export class RoleplaySessionCostDetailDto extends RoleplaySessionCostTotalsDto {
  @ApiProperty() sessionId!: string;
  @ApiProperty({ description: 'Session start (ISO)' }) startedAt!: string;
  @ApiProperty() status!: string;
  @ApiProperty() eventStatus!: string;

  @ApiProperty({
    description:
      'False when the session started before full logging — its cost is an ' +
      'understatement.',
  })
  fullyLogged!: boolean;

  @ApiProperty({ type: [SessionCostLineDto] }) lines!: SessionCostLineDto[];

  @ApiProperty() estimateNote!: string;
}
