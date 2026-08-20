import { ApiProperty } from '@nestjs/swagger';

import {
  ANALYTICS_BUCKETS,
  ANALYTICS_RANGES,
  AnalyticsBucketParam,
  AnalyticsRange,
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';

export class QualitySentimentQueryDto extends AnalyticsWindowQueryDto {}

/**
 * One bucket of the judge-vs-learner comparison.
 *
 * Both figures are NULL rather than absent in a bucket that lacks them: a mean has
 * no meaningful zero, so a quiet bucket must break the line rather than draw it
 * to the floor, and the axis stays a real calendar either way.
 */
export class QualitySentimentPointDto {
  @ApiProperty({ description: 'Bucket start, yyyy-mm-dd' }) bucket!: string;

  @ApiProperty({
    description:
      'Mean LLM-judge composite score (0-100); null if none evaluated',
    nullable: true,
    type: Number,
  })
  avgCompositeScore!: number | null;

  @ApiProperty({ description: 'Evaluated sessions behind the score' })
  evaluatedSessions!: number;

  @ApiProperty({
    description:
      'PROXY NPS on a -100..+100 axis: %promoters - %detractors, cutting the ' +
      '1-5 rating at 5 / 4 / <=3. Null when responses are below ' +
      '`minResponses`, where one rating would swing it by tens of points.',
    nullable: true,
    type: Number,
  })
  proxyNps!: number | null;

  @ApiProperty({
    description: 'Mean raw 1-5 learner rating; null with no responses',
    nullable: true,
    type: Number,
  })
  avgRating!: number | null;

  @ApiProperty({ description: 'Learner ratings received' }) responses!: number;

  @ApiProperty({ description: 'Ratings of 5' }) promoters!: number;
  @ApiProperty({ description: 'Ratings of 4' }) passives!: number;
  @ApiProperty({ description: 'Ratings of 3 or below' }) detractors!: number;
}

export class QualitySentimentResponseDto {
  @ApiProperty({ enum: ANALYTICS_RANGES }) range!: AnalyticsRange;

  @ApiProperty({ enum: ANALYTICS_BUCKETS }) bucket!: AnalyticsBucketParam;

  @ApiProperty({ type: AnalyticsWindowDto }) window!: AnalyticsWindowDto;

  @ApiProperty({
    type: [QualitySentimentPointDto],
    description:
      'Contiguous bucket axis, both series NULL-gap-filled rather than zeroed',
  })
  points!: QualitySentimentPointDto[];

  @ApiProperty({
    description: 'Whole-window mean judge composite; null if none evaluated',
    nullable: true,
    type: Number,
  })
  overallCompositeScore!: number | null;

  @ApiProperty({
    description: 'Whole-window proxy NPS; null below `minResponses`',
    nullable: true,
    type: Number,
  })
  overallProxyNps!: number | null;

  @ApiProperty({ description: 'Whole-window evaluated sessions' })
  totalEvaluatedSessions!: number;

  @ApiProperty({ description: 'Whole-window learner ratings' })
  totalResponses!: number;

  @ApiProperty({
    description: 'Fewest responses a proxy NPS may be stated for',
  })
  minResponses!: number;

  @ApiProperty({
    description:
      'Correlation between the two series across buckets that have BOTH ' +
      '(Pearson r, -1..1). Null with fewer than three such buckets, where a ' +
      'correlation is a line through noise rather than a finding. It is a ' +
      'summary of co-movement, NOT evidence that either causes the other.',
    nullable: true,
    type: Number,
  })
  correlation!: number | null;

  @ApiProperty({
    description: 'Buckets carrying both a score and a stateable proxy NPS',
  })
  pairedBuckets!: number;

  @ApiProperty({
    description:
      'MANDATORY caveat for any surface rendering `proxyNps`. Ally has never ' +
      'asked the 0-10 "would you recommend" question, so this is derived from ' +
      'the 1-5 post-session rating by cutting it the way NPS cuts 0-10. It ' +
      'behaves like NPS and is not NPS: comparable with itself over time, not ' +
      "with anyone else's published score, and it must never be labelled or " +
      'quoted as a plain NPS.',
  })
  proxyNote!: string;

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'Server time the aggregates were computed' })
  computedAt!: string;
}
