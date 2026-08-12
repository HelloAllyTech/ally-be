import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { WaTemplateKind, WaTemplateMatchType } from '../enum/whatsapp.enum';

export class CreateWaTemplateDto {
  @ApiProperty({ enum: WaTemplateKind })
  @IsEnum(WaTemplateKind)
  kind!: WaTemplateKind;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: WaTemplateMatchType })
  @IsEnum(WaTemplateMatchType)
  matchType!: WaTemplateMatchType;

  @ApiProperty({
    type: [String],
    description:
      'Keywords, or one regex source when matchType=regex. ANY_OF matches whole words, which is ' +
      'why it is the right default for short risk words.',
  })
  @IsArray()
  @IsString({ each: true })
  patterns!: string[];

  @ApiPropertyOptional({ description: 'Scope to one language; omit for all' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  languageCode?: string;

  @ApiProperty({
    description:
      'Ascending evaluation order. Bands: crisis 0-99, consent 100-199, command 200-299, faq 300+.',
  })
  @IsInt()
  @Min(0)
  priority!: number;

  @ApiProperty({ description: 'Supports {helpline_numbers}' })
  @IsString()
  @IsNotEmpty()
  responseText!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  bypassRag?: boolean;

  @ApiPropertyOptional({
    default: false,
    description:
      'Stop the matching pass outright. True for crisis and opt-out.',
  })
  @IsOptional()
  @IsBoolean()
  terminal?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateWaTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: WaTemplateMatchType })
  @IsOptional()
  @IsEnum(WaTemplateMatchType)
  matchType?: WaTemplateMatchType;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  patterns?: string[];

  @ApiPropertyOptional() @IsOptional() @IsString() languageCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) priority?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() responseText?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() bypassRag?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() terminal?: boolean;

  @ApiPropertyOptional({
    description:
      'Rejected for a mandatory template — the crisis and opt-out replies cannot be switched off.',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ReorderWaTemplatesDto {
  @ApiProperty({
    type: [String],
    description: 'Template ids in the desired evaluation order',
  })
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}

export class TestWaTemplateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  text!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() language?: string;
}

class WaRateLimitDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) perMinute?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) perHour?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) perDay?: number;
}

class WaRetrievalDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(50) topK?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minSimilarity?: number;

  @ApiPropertyOptional({
    description:
      'The decline decision. Kept separate from minSimilarity because a relevant passage against a ' +
      'paraphrased question scores ~0.40-0.60, so one hard floor would decline constantly.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  declineSimilarity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxPassages?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(200)
  maxContextTokens?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  similarityBand?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() translateQuery?: boolean;
}

export class UpdateWaSettingsDto {
  @ApiPropertyOptional({ description: 'The kill switch' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() consentRequired?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() disclaimerText?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  crisisEscalationText?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fallbackText?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() declineText?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unsupportedMediaText?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() rateLimitText?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() helplineNumbers?: string;

  @ApiPropertyOptional({ type: WaRateLimitDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WaRateLimitDto)
  rateLimit?: WaRateLimitDto;

  @ApiPropertyOptional({ type: WaRetrievalDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WaRetrievalDto)
  retrieval?: WaRetrievalDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(100)
  maxAnswerChars?: number;

  @ApiPropertyOptional({
    description:
      'Hard ceiling for the whole message. 1600 is the portable cross-provider limit.',
  })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(4096)
  maxReplyChars?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  maxCitations?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(5)
  conversationIdleMinutes?: number;

  /**
   * Days before message bodies and phone numbers are blanked. 0 disables the sweep.
   *
   * No upper bound, but a floor of 0 with an explicit "disabled" meaning rather than an optional
   * field that silently means "never" when absent — the retention window is the one setting where
   * "unset" must not be the permissive value.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  retentionDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  crisisClassifierEnabled?: boolean;
}

export class PreviewAskDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  question!: string;

  @ApiPropertyOptional({
    description:
      'Override the stored retrieval settings for this one call, for tuning',
    type: WaRetrievalDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => WaRetrievalDto)
  retrieval?: WaRetrievalDto;
}
