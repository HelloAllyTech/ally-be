import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { BugFindingSource } from '../enum/bug-finding.enum';
import {
  BugHunterEvalLabel,
  BugHunterEvalLabelSource,
  BugHunterEvalPromptKind,
} from '../enum/bug-hunter-eval.enum';

/** One settled finding, as the replay script needs it: the brief the verifier saw, plus the truth. */
export class BugHunterEvalItemDto {
  @ApiProperty() findingId!: string;
  @ApiProperty() repo!: string;
  @ApiProperty({ enum: BugFindingSource }) source!: BugFindingSource;
  @ApiProperty({ nullable: true }) file!: string | null;
  @ApiProperty({ nullable: true }) symbol!: string | null;
  /** The ORIGINAL description where an admin later rewrote it — the verifier judged the finder's words, not the edit. */
  @ApiProperty() description!: string;
  @ApiProperty({ nullable: true }) evidence!: string | null;
  @ApiProperty({ enum: BugHunterEvalLabel }) label!: BugHunterEvalLabel;
  @ApiProperty({ enum: BugHunterEvalLabelSource })
  labelSource!: BugHunterEvalLabelSource;
  /** Human-settled or outcome-settled tiers are strong; an uncontradicted verifier dismissal is weak. */
  @ApiProperty({ enum: ['strong', 'weak'] }) labelStrength!: 'strong' | 'weak';
  /** When the finding was filed — the commit to replay against is the one current then. */
  @ApiProperty() discoveredAt!: Date;
  @ApiProperty({ nullable: true }) settledAt!: Date | null;
  /** What the run's verifiers said at the time, if recorded — for comparing a new prompt against the old verdict. */
  @ApiProperty({ nullable: true }) originalConfidence!: number | null;
}

export class BugHunterEvalSetDto {
  @ApiProperty({ type: [BugHunterEvalItemDto] }) items!: BugHunterEvalItemDto[];
  @ApiProperty({
    description:
      'Items per label, so a lopsided set is visible before anyone spends tokens on it.',
  })
  counts!: Record<BugHunterEvalLabel, number>;
  @ApiProperty() generatedAt!: string;
}

export class BugHunterEvalSetQueryDto {
  @ApiPropertyOptional({ description: 'One repo, or every repo when omitted.' })
  @IsOptional()
  @IsString()
  repo?: string;

  @ApiPropertyOptional({ default: 60, maximum: 500 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Include the weak tier (uncontradicted verifier dismissals). Off by default.',
    default: false,
  })
  @IsOptional()
  @IsString()
  includeWeak?: string;
}

class EvalBucketDto {
  @ApiProperty() items!: number;
  @ApiProperty() agreed!: number;
}

export class RecordBugHunterEvalRunDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  repo?: string;

  @ApiProperty({ enum: BugHunterEvalPromptKind })
  @IsEnum(BugHunterEvalPromptKind)
  promptKind!: BugHunterEvalPromptKind;

  @ApiProperty({ description: 'sha256 hex of the prompt text as run.' })
  @IsString()
  @Length(64, 64)
  promptHash!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  model!: string;

  @ApiPropertyOptional({
    description: 'sha256 hex of the eval-set file replayed.',
  })
  @IsOptional()
  @IsString()
  @Length(64, 64)
  setHash?: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  itemCount!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  answeredCount!: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  agreement?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  realRecall?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  notABugRecall?: number | null;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  perSource?: Record<string, EvalBucketDto>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  perLabelSource?: Record<string, EvalBucketDto>;

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  calibration?: Array<{ bucket: string; items: number; agreed: number }>;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costUsd?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationMs?: number | null;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class BugHunterEvalRunDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true }) repo!: string | null;
  @ApiProperty({ enum: BugHunterEvalPromptKind })
  promptKind!: BugHunterEvalPromptKind;
  @ApiProperty() promptHash!: string;
  @ApiProperty() model!: string;
  @ApiProperty({ nullable: true }) setHash!: string | null;
  @ApiProperty() itemCount!: number;
  @ApiProperty() answeredCount!: number;
  @ApiProperty({ nullable: true }) agreement!: number | null;
  @ApiProperty({ nullable: true }) realRecall!: number | null;
  @ApiProperty({ nullable: true }) notABugRecall!: number | null;
  @ApiProperty({ nullable: true, type: Object })
  perSource!: Record<string, EvalBucketDto> | null;
  @ApiProperty({ nullable: true, type: Object })
  perLabelSource!: Record<string, EvalBucketDto> | null;
  @ApiProperty({ nullable: true, type: [Object] })
  calibration!: Array<{ bucket: string; items: number; agreed: number }> | null;
  @ApiProperty({ nullable: true }) costUsd!: number | null;
  @ApiProperty({ nullable: true }) durationMs!: number | null;
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty() createdAt!: Date;
}

export class ListBugHunterEvalRunsDto {
  @ApiProperty({ type: [BugHunterEvalRunDto] }) items!: BugHunterEvalRunDto[];
}
