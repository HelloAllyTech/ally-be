import { IsIn, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ANALYTICS_RANGES, AnalyticsRange } from './platform-analytics.dto';

/**
 * Scribe-session analytics (super-admin, platform-wide / cross-tenant). These
 * metrics are derived from the `chats` table (real counselor sessions that get
 * transcribed + summarised), as opposed to the AI/simulation analytics which
 * are derived from `scenario_sessions`. Time window selected via `range`:
 * 30d -> daily buckets, 90d -> weekly, 12m -> monthly.
 */
export class ScribeAnalyticsQueryDto {
  @ApiProperty({
    description: 'Time window for scribe analytics',
    enum: ANALYTICS_RANGES,
    default: '30d',
    required: false,
  })
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range?: AnalyticsRange;
}

/** A single point on a count-over-time trend. */
export class ScribeTrendPointDto {
  @ApiProperty({ description: 'Bucket start (yyyy-mm-dd)' }) bucket!: string;
  @ApiProperty() count!: number;
}

/** A labelled count for a breakdown (donut/bar). */
export class ScribeCountDto {
  @ApiProperty() key!: string;
  @ApiProperty() count!: number;
}

export class ScribeOverviewSummaryDto {
  @ApiProperty({ description: 'All scribe sessions created in the window' })
  totalSessions!: number;
  @ApiProperty({ description: 'summarised OK / (summarised OK + failed), %' })
  successRatePct!: number;
  @ApiProperty({ description: 'PENDING + IN_PROGRESS (still being processed)' })
  processing!: number;
  @ApiProperty({ description: 'Sessions with no audio to summarise' })
  noAudio!: number;
  @ApiProperty({ description: 'Sessions whose summary ended in FAILED' })
  failed!: number;
}

export class ScribeOverviewResponseDto {
  @ApiProperty() range!: AnalyticsRange;
  @ApiProperty({ enum: ['day', 'week', 'month'] }) bucket!: string;
  @ApiProperty({ type: ScribeOverviewSummaryDto })
  summary!: ScribeOverviewSummaryDto;
  @ApiProperty({
    type: [ScribeTrendPointDto],
    description: 'Scribe sessions created per bucket (gap-filled).',
  })
  sessionsTrend!: ScribeTrendPointDto[];
  @ApiProperty({
    type: [ScribeCountDto],
    description: 'Sessions by summaryStatus (SUCCESS/FAILED/...).',
  })
  outcomeBreakdown!: ScribeCountDto[];
  @ApiProperty({
    type: [ScribeCountDto],
    description: 'Sessions by mode (SCRIBE upload vs DICTATION live).',
  })
  modeBreakdown!: ScribeCountDto[];
}

/** A single point on the summary-failure-rate trend. */
export class ScribeFailureRatePointDto {
  @ApiProperty({ description: 'Bucket start (yyyy-mm-dd)' }) bucket!: string;
  @ApiProperty({ description: 'Sessions that ended FAILED in this bucket' })
  failed!: number;
  @ApiProperty({ description: 'Terminal sessions (SUCCESS + FAILED)' })
  terminal!: number;
  @ApiProperty({ description: 'failed / terminal, 0..1' })
  failureRate!: number;
}

export class ScribeFailureSummaryDto {
  @ApiProperty({
    description: 'Terminal sessions in window (SUCCESS + FAILED)',
  })
  totalTerminal!: number;
  @ApiProperty() totalFailed!: number;
  @ApiProperty({ description: 'failed / terminal across the window, %' })
  failureRatePct!: number;
  @ApiProperty({ description: '% of failures still flagged retryable' })
  retryableSharePct!: number;
  @ApiProperty({ description: '% of failures caused by the summary timeout' })
  timeoutSharePct!: number;
}

export class ScribeSummaryFailureResponseDto {
  @ApiProperty() range!: AnalyticsRange;
  @ApiProperty({ enum: ['day', 'week', 'month'] }) bucket!: string;
  @ApiProperty({ type: ScribeFailureSummaryDto })
  summary!: ScribeFailureSummaryDto;
  @ApiProperty({ type: [ScribeFailureRatePointDto] })
  failureRateTrend!: ScribeFailureRatePointDto[];
  @ApiProperty({
    type: [ScribeCountDto],
    description:
      'Failures by pipeline stage (transcribe/diarize/summarize/...).',
  })
  failuresByStage!: ScribeCountDto[];
  @ApiProperty({
    type: [ScribeCountDto],
    description:
      'Top raw failure reasons (metadata.error, first 80 chars) — reveals ' +
      'what the generic stage buckets actually contain.',
  })
  topFailureReasons!: ScribeCountDto[];
  @ApiProperty({
    type: [ScribeCountDto],
    description:
      'Stored-audio state of failed sessions: upload-never-finalized ' +
      '(abnormal end) vs uploaded-ok (lifecycle expiry) vs no-upload-record ' +
      '/ upload-failed / audio-cleared.',
  })
  audioStatusBreakdown!: ScribeCountDto[];
  @ApiProperty({
    type: [ScribeCountDto],
    description: 'Failures split into retryable vs terminal.',
  })
  retryableBreakdown!: ScribeCountDto[];
  @ApiProperty({
    type: [ScribeCountDto],
    description: 'Failures split into summary-timeout vs other error.',
  })
  timeoutBreakdown!: ScribeCountDto[];
}
