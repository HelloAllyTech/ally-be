import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsOptional, IsString } from 'class-validator';

export class GlossaryEffectQueryDto {
  @ApiPropertyOptional({
    description: 'Restrict to one language (languages.value), e.g. ta-IN',
    example: 'ta-IN',
  })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({
    description:
      'Include internal/demo/QA orgs. Default false, as on every other ' +
      'analytics surface. Their sessions are always COUNTED in ' +
      '`testSessionsExcluded` so a thin cell reads as excluded, not clean.',
    example: 'false',
  })
  @IsOptional()
  @IsBooleanString()
  includeTestOrganizations?: string;
}

/**
 * One (language, period, agentModel) cell.
 *
 * The grain is the point: the agent model is never pooled away, so a model
 * change cannot be mistaken for a glossary effect. Compare cells that share a
 * language AND an agentModel; anything else is not a comparison.
 */
export class GlossaryEffectCellDto {
  @ApiProperty({ example: 'ta-IN' })
  languageValue!: string;

  @ApiProperty({
    description:
      "Relative to THIS language's own glossary go-live, derived from its " +
      'earliest published section — not a platform-wide date.',
    enum: ['before', 'after'],
  })
  period!: 'before' | 'after';

  @ApiProperty({
    description: 'Modal agent LLM for the session; "unknown" when unrecorded',
    example: 'gpt-4o-mini',
  })
  agentModel!: string;

  @ApiProperty({ description: 'Sessions in this cell (test orgs excluded)' })
  sessions!: number;

  @ApiProperty({ description: 'Judged turns — the naturalness denominator' })
  turns!: number;

  @ApiProperty({
    description: 'Agent messages scanned — the adherence denominator',
  })
  agentMessages!: number;

  @ApiProperty({
    description:
      'Deterministic avoid-term hits per 100 agent messages. No model in ' +
      'the loop, so this is comparable across periods without pinning.',
    example: 6.17,
  })
  adherencePer100Messages!: number;

  @ApiProperty({
    description:
      'Severity-weighted style error rate per 100 judged turns ' +
      '(minor 1 / major 5 / critical 10). Null when no judged turns fall in ' +
      'this cell — never 0, which would read as clean.',
    nullable: true,
    example: 154,
  })
  stylePer100Turns!: number | null;

  @ApiProperty({
    description:
      'Sessions omitted from the metrics as internal/demo/QA traffic. A cell ' +
      'with few sessions and many here is a coverage gap, not a clean result.',
  })
  testSessionsExcluded!: number;
}

export class GlossaryGoLiveDto {
  @ApiProperty({ example: 'ta-IN' })
  languageValue!: string;

  @ApiProperty({ nullable: true, example: 'Tamil (India)' })
  languageLabel!: string | null;

  @ApiProperty({
    description:
      "Earliest published section — this language's intervention date",
    example: '2026-07-22',
  })
  goLiveAt!: string;
}

export class GlossaryEffectResponseDto {
  @ApiProperty({
    description:
      'The judge tuple every naturalness figure is pinned to. Rates from ' +
      'different tuples are not comparable.',
  })
  judgeVersion!: { judgeModel: string; judgePromptVersion: string };

  @ApiProperty({
    type: [GlossaryGoLiveDto],
    description:
      'Per-language go-live dates actually used. Languages differ — English ' +
      'published on 2026-08-20 and the rest on 2026-07-22 — so one shared ' +
      'date silently mismeasures whichever languages it does not match.',
  })
  goLive!: GlossaryGoLiveDto[];

  @ApiProperty({ type: [GlossaryEffectCellDto] })
  cells!: GlossaryEffectCellDto[];
}
