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

  // --- Roleplay Quality Index (the series the card now plots) ---

  @ApiProperty({
    nullable: true,
    description:
      'Roleplay Quality Index, 0-100. Weighted blend of the four dimensions ' +
      'that had data in this bucket, renormalised over the present weights. ' +
      'Null when no dimension had data.',
  })
  qualityIndex!: number | null;

  @ApiProperty({
    description:
      'Per-dimension stack heights. The present layers sum exactly to ' +
      'qualityIndex, which is why they are what the chart stacks rather than ' +
      'the normalised scores.',
    additionalProperties: { type: 'number' },
  })
  indexContributions!: Record<string, number>;

  @ApiProperty({
    description:
      "Each dimension's raw value in its own unit (see indexCoverage[].unit), " +
      'so a reader can check the index against the Drift, Language and Latency ' +
      'tabs rather than taking the composite on trust.',
    additionalProperties: { type: 'number' },
  })
  indexRaw!: Record<string, number>;

  @ApiProperty({
    description:
      'Rows behind each dimension here — sessions, or turns for latency.',
    additionalProperties: { type: 'number' },
  })
  indexSampleSizes!: Record<string, number>;

  @ApiProperty({
    type: [String],
    description:
      'Dimensions with no data in this bucket. Non-empty means qualityIndex is ' +
      'a blend of fewer than four dimensions — not that quality was low.',
  })
  indexMissing!: string[];
}

/**
 * One dimension's standing in the index: how it is weighted, how far its data
 * reaches, and whether its 0-100 anchors are measured or still the shipped guess.
 *
 * `calibrated: false` is the field that must never be ignored by a client. An
 * index normalised against invented anchors looks exactly like one normalised
 * against measured ones, so the card is responsible for saying which it is.
 */
export class QualityIndexCoverageDto {
  @ApiProperty({ description: 'Dimension key, e.g. responseLatency' })
  dimension!: string;

  @ApiProperty({ description: 'Display label for the stack legend' })
  label!: string;

  @ApiProperty({ description: "Unit of this dimension's raw value" })
  unit!: string;

  @ApiProperty({ description: 'Weight in the composite (weights sum to 1)' })
  weight!: number;

  @ApiProperty({
    description: 'Buckets in the window where this dimension had data',
  })
  bucketsCovered!: number;

  @ApiProperty({
    description: 'Buckets in the window where any dimension had data',
  })
  bucketsTotal!: number;

  @ApiProperty({
    description:
      'False while this dimension is normalised against shipped placeholder ' +
      'anchors rather than anchors measured from production traffic.',
  })
  calibrated!: boolean;

  @ApiProperty({ description: 'Raw value that normalises to 100' })
  target!: number;

  @ApiProperty({ description: 'Raw value that normalises to 0' })
  ceiling!: number;

  @ApiProperty({
    nullable: true,
    description: 'Rows behind the measured anchors. Null while placeholder.',
  })
  sampleSize!: number | null;

  @ApiProperty({
    nullable: true,
    description: 'When the anchors were measured. Null while placeholder.',
  })
  measuredAt!: Date | null;
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

  @ApiProperty({
    description:
      "The index definition's version stamp. Bumped whenever a weight, a " +
      "direction or a dimension's raw metric changes — any of which moves every " +
      'historical point without anyone having practised differently. Render it ' +
      'on the card so a step in the line can be told apart from a step in the ' +
      'product.',
  })
  indexVersion!: string;

  @ApiProperty({
    description:
      'True only when EVERY dimension has measured anchors. False means the ' +
      'line is drawn against shipped guesses and must be captioned as such.',
  })
  indexCalibrated!: boolean;

  @ApiProperty({
    type: [QualityIndexCoverageDto],
    description:
      'Per-dimension weight, coverage and calibration state, in the order the ' +
      'contributions stack.',
  })
  indexCoverage!: QualityIndexCoverageDto[];

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'Server time the aggregates were computed' })
  computedAt!: string;
}
