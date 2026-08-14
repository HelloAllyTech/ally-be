import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BugHuntRunStatus, BugHuntTrigger } from '../enum/bug-hunt-run.enum';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';
import {
  BugFindingSeverity,
  BugFindingSource,
  BugFindingStatus,
  BugHunterMode,
} from '../enum/bug-finding.enum';

export class BugHuntEventDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true })
  runId!: string | null;

  @ApiProperty({ nullable: true })
  repo!: string | null;

  @ApiProperty({ enum: BugHuntEventStage })
  stage!: BugHuntEventStage;

  @ApiProperty()
  summary!: string;

  @ApiProperty({ type: Object, nullable: true })
  payload!: Record<string, any> | null;

  @ApiProperty({ nullable: true })
  suggestionId!: string | null;

  @ApiProperty({ nullable: true })
  findingId!: string | null;

  @ApiProperty()
  createdAt!: Date;
}

export class BugHunterSettingsDto {
  @ApiProperty({
    enum: BugHunterMode,
    description:
      'OFF blocks every trigger. MANUAL and AI both let discovery run; only MANUAL gates the fix stage on an admin approval.',
  })
  mode!: BugHunterMode;

  @ApiProperty({ nullable: true })
  updatedBy!: number | null;

  @ApiProperty()
  updatedAt!: Date;
}

export class UpdateBugHunterSettingsDto {
  @ApiProperty({ enum: BugHunterMode })
  @IsEnum(BugHunterMode)
  mode!: BugHunterMode;
}

export class BugFindingDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true })
  runId!: string | null;

  @ApiProperty({ nullable: true })
  repo!: string | null;

  @ApiProperty({ enum: BugFindingSource })
  source!: BugFindingSource;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ nullable: true })
  file!: string | null;

  @ApiProperty({ nullable: true })
  evidence!: string | null;

  @ApiProperty({ enum: BugFindingSeverity, nullable: true })
  severity!: BugFindingSeverity | null;

  @ApiProperty()
  proven!: boolean;

  @ApiProperty()
  touchesGuardedPath!: boolean;

  @ApiProperty({ nullable: true })
  reportedBugId!: string | null;

  @ApiProperty({ enum: BugFindingStatus })
  status!: BugFindingStatus;

  @ApiProperty({ nullable: true })
  prUrl!: string | null;

  @ApiProperty({ nullable: true })
  escalationQuestion!: string | null;

  @ApiProperty({ nullable: true })
  escalationAnswer!: string | null;

  @ApiProperty({ nullable: true })
  escalationAnsweredBy!: number | null;

  @ApiProperty({ nullable: true })
  escalationAnsweredAt!: Date | null;

  @ApiProperty({ nullable: true })
  decidedBy!: number | null;

  @ApiProperty({ nullable: true })
  decidedAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class BugFindingDetailDto extends BugFindingDto {
  @ApiProperty({ type: [BugHuntEventDto] })
  events!: BugHuntEventDto[];
}

export class ListBugFindingsQueryDto {
  @ApiProperty({
    enum: [...Object.values(BugFindingStatus), 'all'],
    required: false,
  })
  @IsOptional()
  @IsIn([...Object.values(BugFindingStatus), 'all'])
  status?: BugFindingStatus | 'all';

  @ApiProperty({ enum: BugFindingSource, required: false })
  @IsOptional()
  @IsEnum(BugFindingSource)
  source?: BugFindingSource;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  repo?: string;

  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class ListBugFindingsResponseDto {
  @ApiProperty({ type: [BugFindingDto] })
  items!: BugFindingDto[];

  @ApiProperty()
  count!: number;
}

export class AnswerBugFindingDto {
  @ApiProperty()
  @IsString()
  answer!: string;
}

export class BugHuntRunDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: BugHuntTrigger })
  trigger!: BugHuntTrigger;

  @ApiProperty()
  repo!: string;

  @ApiProperty({ enum: BugHuntRunStatus })
  status!: BugHuntRunStatus;

  @ApiProperty({ nullable: true })
  finishedAt!: Date | null;

  @ApiProperty()
  foundCount!: number;

  @ApiProperty()
  autoMergedCount!: number;

  @ApiProperty()
  prOpenedCount!: number;

  @ApiProperty()
  dismissedCount!: number;

  @ApiProperty({
    description: 'USD, snapshotted from llm_usage at close time.',
  })
  totalTokenCostUsd!: string;

  @ApiProperty()
  createdAt!: Date;
}

export class BugHuntRunDetailDto extends BugHuntRunDto {
  @ApiProperty({ type: [BugHuntEventDto] })
  events!: BugHuntEventDto[];
}

export class ListBugHuntRunsResponseDto {
  @ApiProperty({ type: [BugHuntRunDto] })
  items!: BugHuntRunDto[];
}
