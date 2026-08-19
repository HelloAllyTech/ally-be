import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID } from 'class-validator';

export enum WeakMetricsBucket {
  WEEK = 'week',
  MONTH = 'month',
}

export enum WeakMetricsRange {
  D30 = '30d',
  D90 = '90d',
  M12 = '12m',
  ALL = 'all',
}

export class WeakMetricsQueryDto {
  @ApiPropertyOptional({
    enum: WeakMetricsRange,
    default: WeakMetricsRange.M12,
    description: 'Window to read. Defaults to 12 months.',
  })
  @IsOptional()
  @IsEnum(WeakMetricsRange)
  range?: WeakMetricsRange;

  @ApiPropertyOptional({
    enum: WeakMetricsBucket,
    default: WeakMetricsBucket.MONTH,
    description:
      'Trend granularity. Month is the default: the judges give six clean ' +
      'monthly points and weekly cells go thin at the edges.',
  })
  @IsOptional()
  @IsEnum(WeakMetricsBucket)
  bucket?: WeakMetricsBucket;

  @ApiPropertyOptional({ description: "Language code, e.g. 'ta-IN'" })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({
    description:
      'LLM model slice. Repetition differs 6.6x between models, so an ' +
      'unsegmented read of that metric tracks traffic mix, not quality.',
  })
  @IsOptional()
  @IsString()
  llmModel?: string;

  @ApiPropertyOptional({ description: 'Restrict to one scenario' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  scenarioId?: number;

  @ApiPropertyOptional({ description: 'Restrict to one scenario version' })
  @IsOptional()
  @IsUUID()
  scenarioVersionId?: string;

  @ApiPropertyOptional({
    description:
      'Main-agent prompt version. The slice to use when the question is ' +
      '"did the prompt change fix it?" — comparing two versions over the same ' +
      'window separates the change from everything else that moved that month.',
  })
  @IsOptional()
  @IsString()
  promptVersion?: string;
}

export class WeakMetricPointDto {
  @ApiProperty({ description: 'Bucket start, YYYY-MM-DD' })
  bucket!: string;

  @ApiProperty({ description: 'Raw numerator — never a pre-divided rate' })
  numerator!: number;

  @ApiProperty({ description: 'Raw denominator; 0 renders as "no data"' })
  denominator!: number;

  @ApiProperty({
    nullable: true,
    description: 'numerator / denominator, or null when the denominator is 0',
  })
  value!: number | null;
}

export enum WeakMetricState {
  MEASURED = 'measured',
  PARTIAL = 'partial',
  NONE = 'none',
}

export class WeakMetricSeriesDto {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;

  @ApiProperty({
    description:
      "How to render value: 'percent' | 'per100turns' | 'ratio' | 'count'",
  })
  unit!: string;

  @ApiProperty({
    enum: WeakMetricState,
    description:
      'measured = trustworthy today; partial = a proxy or a half-built ' +
      'signal; none = no measurement exists and the series is a placeholder.',
  })
  state!: WeakMetricState;

  @ApiProperty({
    nullable: true,
    description:
      'Whether lower is better — drives the improving/worsening wording. NULL ' +
      'means the metric has no good direction and movement must be reported ' +
      'without a verdict. Barge-in is the case that forced this: interruption ' +
      'is ordinary conversation, and its rate is flat at ~2.5-2.8% across every ' +
      'actor turn length above 100 characters, dropping only on turns too short ' +
      'to interrupt. It measures opportunity, not quality.',
  })
  lowerIsBetter!: boolean | null;

  @ApiProperty({
    description:
      'One plain line saying what this counts. The label is a name to scan ' +
      'for; this is the sentence that makes it unambiguous without opening ' +
      'anything.',
  })
  description!: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The caveat a reader must hold to read this series honestly — how it is ' +
      'weighted, what it excludes, where it under-detects. Reference material ' +
      'rather than the headline, so the UI puts it behind a tooltip: as body ' +
      'text on every card it crowded out the numbers it was meant to qualify.',
  })
  caveat?: string | null;

  @ApiProperty({ type: [WeakMetricPointDto] })
  points!: WeakMetricPointDto[];

  @ApiProperty({
    nullable: true,
    description: 'Latest non-empty bucket value',
  })
  latest!: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Previous non-empty bucket value, for the delta arrow',
  })
  previous!: number | null;
}

export class WeakMetricGroupDto {
  @ApiProperty({ description: 'One of the five weak-performing metrics' })
  id!: string;

  @ApiProperty() label!: string;

  @ApiProperty({
    enum: WeakMetricState,
    description: 'Worst state across the series in this group',
  })
  state!: WeakMetricState;

  @ApiProperty({ description: 'What this metric measures, in one line' })
  description!: string;

  @ApiProperty({ type: [WeakMetricSeriesDto] })
  series!: WeakMetricSeriesDto[];
}

export class WeakMetricScenarioRowDto {
  @ApiProperty() scenarioId!: number;
  @ApiProperty({ nullable: true }) title!: string | null;
  @ApiProperty({ nullable: true }) language!: string | null;
  @ApiProperty() sessions!: number;
  @ApiProperty() turns!: number;
  @ApiProperty() slips!: number;
  @ApiProperty({ description: 'slips / turns' }) rate!: number;
}

export class WeakMetricFilterOptionsDto {
  @ApiProperty({ type: [String] }) languages!: string[];
  @ApiProperty({ type: [String] }) models!: string[];
  @ApiProperty({
    type: [String],
    description: 'Prompt versions that have judged data behind them',
  })
  promptVersions!: string[];
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        title: { type: 'string', nullable: true },
      },
    },
  })
  scenarios!: Array<{ id: number; title: string | null }>;
}

export class WeakMetricsResponseDto {
  @ApiProperty({
    description:
      'Deterministic-parameter version. Thresholds (re-prompt gap, loop run ' +
      'length, stasis overlap) define these metrics; bump this when one ' +
      'changes so a shift in a chart can be told from a shift in the product.',
  })
  metricsVersion!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    description: 'The deterministic thresholds actually applied to this read',
  })
  parameters!: Record<string, number>;

  @ApiProperty({
    nullable: true,
    description: 'Drift judge pin. Kept for compatibility — see judgeVersions.',
  })
  judgeModel!: string | null;

  @ApiProperty({ nullable: true })
  judgePromptVersion!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'The pinned judge version PER FAMILY. Three judges write the tables behind ' +
      'this tab and they version independently, so one number cannot describe ' +
      'all of them — reporting a single version was how the language series ' +
      "came to be read through the drift judge's version.",
  })
  judgeVersions!: {
    drift: { judgeModel: string; judgePromptVersion: string } | null;
    language: { judgeModel: string; judgePromptVersion: string } | null;
    groundedness: { judgeModel: string; judgePromptVersion: string } | null;
  };

  @ApiProperty({ description: 'Bucket granularity applied' })
  bucket!: string;

  @ApiProperty({ description: 'Window start, ISO' })
  start!: string;

  @ApiProperty({ type: [WeakMetricGroupDto] })
  groups!: WeakMetricGroupDto[];

  @ApiProperty({
    type: [WeakMetricScenarioRowDto],
    description:
      'Worst scenarios by role-slip rate. The unit of action is the scenario ' +
      'brief, not the global prompt — a quarter of all slips sit in three ' +
      'scenarios, and an English one is among the worst.',
  })
  worstScenarios!: WeakMetricScenarioRowDto[];

  @ApiProperty({
    nullable: true,
    description:
      'Pearson r of skill score against log(turn count). High means the ' +
      'learner-facing score is substantially measuring session length.',
  })
  scoreLengthCorrelation!: number | null;

  @ApiProperty({ type: WeakMetricFilterOptionsDto })
  filterOptions!: WeakMetricFilterOptionsDto;
}
