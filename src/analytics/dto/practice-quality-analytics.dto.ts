import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

import {
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';

/**
 * Was it practice? — GET /v1/analytics/practice-quality (Highlights → Usage,
 * AAQ-208 "Learner talk share per session" and AAQ-209 "Sessions that count as
 * practice").
 *
 * Per countable roleplay session in the window, read off the transcript's
 * shape (ruler R7, deterministic — no judge): how much of the conversation the
 * learner did, and whether the session held enough of the learner's own
 * speech to count as practice at all. A roleplay is meant to be mostly doing;
 * a session where the client did nearly all the talking was mostly listening.
 *
 * Calendar x-axis (bucketed by session end), so it takes the shared window
 * params. Platform-wide unless `tenantId` narrows it; test organisations
 * always excluded. This shape is a frontend contract.
 */

export class PracticeQualityQueryDto extends AnalyticsWindowQueryDto {
  @ApiProperty({
    description:
      "Filter by the session's language value (e.g. en-IN, hi-IN). Characters per " +
      'word differ by script, so talk share is best compared within one language.',
    required: false,
  })
  @IsOptional()
  @IsString()
  language?: string;
}

export class PracticeQualityThresholdsDto {
  @ApiProperty({
    description: 'A practice session has at least this many learner turns',
    example: 3,
  })
  minLearnerTurns!: number;

  @ApiProperty({
    description:
      'A practice session lasted at least this many minutes, net of pauses',
    example: 2,
  })
  minDurationMinutes!: number;

  @ApiProperty({
    description:
      'A practice session holds at least this many characters of the learner’s own speech',
    example: 300,
  })
  minLearnerChars!: number;
}

export class PracticeQualityPointDto {
  @ApiProperty({ description: 'Bucket start (yyyy-mm-dd), by session end' })
  bucket!: string;

  @ApiProperty({
    description:
      'Countable sessions that ended in the bucket. A real 0 when none did (the axis is gap-filled)',
  })
  sessions!: number;

  @ApiProperty({
    description:
      'Of those, sessions with any speech at all — the n behind the talk-share percentiles',
  })
  talkShareSessions!: number;

  @ApiProperty({
    description:
      'AAQ-208. Median learner talk share: learner characters ÷ all characters, per session, as a percentage. Null below `minSampleSize` talkShareSessions',
    nullable: true,
    type: Number,
  })
  talkShareMedianPct!: number | null;

  @ApiProperty({
    description: '25th percentile of talk share (%); null below the floor',
    nullable: true,
    type: Number,
  })
  talkShareP25Pct!: number | null;

  @ApiProperty({
    description: '75th percentile of talk share (%); null below the floor',
    nullable: true,
    type: Number,
  })
  talkShareP75Pct!: number | null;

  @ApiProperty({
    description:
      'AAQ-208 second line. Median learner turns per session (non-empty learner lines); null below `minSampleSize` sessions',
    nullable: true,
    type: Number,
  })
  learnerTurnsMedian!: number | null;

  @ApiProperty({
    description:
      'Sessions that count as practice (every `practiceThresholds` rule met)',
  })
  practiceSessions!: number;

  @ApiProperty({
    description:
      'AAQ-209. practiceSessions ÷ sessions, as a percentage; null below `minSampleSize` sessions',
    nullable: true,
    type: Number,
  })
  practicePct!: number | null;

  @ApiProperty({
    description: `Sessions with fewer than \`minLearnerTurns\` learner turns`,
  })
  shortTurnSessions!: number;

  @ApiProperty({
    description:
      'shortTurnSessions ÷ sessions, as a percentage; null below `minSampleSize` sessions',
    nullable: true,
    type: Number,
  })
  shortTurnsPct!: number | null;
}

export class PracticeQualitySummaryDto {
  @ApiProperty({ description: 'Countable sessions in the whole window' })
  sessions!: number;

  @ApiProperty({ description: 'Of those, sessions with any speech' })
  talkShareSessions!: number;

  @ApiProperty({
    description:
      'Median talk share over the whole window’s sessions (not a median of bucket medians); null below the floor',
    nullable: true,
    type: Number,
  })
  talkShareMedianPct!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  talkShareP25Pct!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  talkShareP75Pct!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  learnerTurnsMedian!: number | null;

  @ApiProperty({ description: 'Sessions that count as practice' })
  practiceSessions!: number;

  @ApiProperty({
    description: 'practiceSessions ÷ sessions (%); null below the floor',
    nullable: true,
    type: Number,
  })
  practicePct!: number | null;

  @ApiProperty({
    description: 'Sessions with fewer than `minLearnerTurns` learner turns',
  })
  shortTurnSessions!: number;

  @ApiProperty({
    description:
      'shortTurnSessions ÷ sessions (%): the share that were not practice for want of turns — the takeaway number. Null below the floor',
    nullable: true,
    type: Number,
  })
  notPracticeShortTurnsPct!: number | null;
}

export class PracticeQualityProvenanceDto {
  @ApiProperty({
    description: 'Ruler (R7, transcript shape) and how the numbers are made',
  })
  derivation!: string;

  @ApiProperty({ description: 'The caveat the card must carry' })
  note!: string;
}

export class PracticeQualityResponseDto {
  @ApiProperty({ type: AnalyticsWindowDto })
  window!: AnalyticsWindowDto;

  @ApiProperty({
    description: 'The language filter applied, or null for every language',
    nullable: true,
    type: String,
  })
  language!: string | null;

  @ApiProperty({
    description:
      'Percentiles, medians and shares over fewer than this many sessions are withheld (null); counts still travel',
  })
  minSampleSize!: number;

  @ApiProperty({ type: PracticeQualityThresholdsDto })
  practiceThresholds!: PracticeQualityThresholdsDto;

  @ApiProperty({
    type: [PracticeQualityPointDto],
    description:
      'Every bucket in the window, in order. `window.inProgressBucket` is still accruing — table it, leave it off the line',
  })
  points!: PracticeQualityPointDto[];

  @ApiProperty({ type: PracticeQualitySummaryDto })
  summary!: PracticeQualitySummaryDto;

  @ApiProperty({ type: PracticeQualityProvenanceDto })
  provenance!: PracticeQualityProvenanceDto;

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty()
  computedAt!: string;
}
