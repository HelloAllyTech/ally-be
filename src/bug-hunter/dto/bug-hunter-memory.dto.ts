import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { AGENT_MEMORY_BODY_MAX } from 'src/agent-memory/entity/agent-memory.entity';
import { AGENT_MEMORY_MAX_HITS } from 'src/agent-memory/service/agent-memory.service';

/** One notebook entry as the agent or an admin writes it. */
export class WriteBugHunterMemoryDto {
  @ApiProperty({
    maxLength: AGENT_MEMORY_BODY_MAX,
    description:
      'The one lesson, written for a stranger: name the repo, file, command or symptom. Under 600 characters.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(AGENT_MEMORY_BODY_MAX)
  body!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Repos this applies to. Omit for platform-wide.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  repos?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Open labels: verification, flaky-test, fix-gotcha, false-positive, whatever fits. Not a fixed list.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'The run whose reflection wrote this.' })
  @IsOptional()
  @IsUUID()
  runId?: string;

  @ApiPropertyOptional({ description: 'The finding this was learned from.' })
  @IsOptional()
  @IsUUID()
  findingId?: string;

  @ApiPropertyOptional({
    description:
      'Admins only: a pinned entry is never edited or retired by the curator.',
  })
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

export class SearchBugHunterMemoryQueryDto {
  @ApiProperty({ description: 'What the agent is asking its notebook.' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  q!: string;

  @ApiPropertyOptional({
    description: 'Narrow to entries for this repo plus platform-wide ones.',
  })
  @IsOptional()
  @IsString()
  repo?: string;

  @ApiPropertyOptional({ default: 3, maximum: AGENT_MEMORY_MAX_HITS })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(AGENT_MEMORY_MAX_HITS)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Override the configured relevance floor, 0-1.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minSimilarity?: number;

  @ApiPropertyOptional({
    description:
      'The run making the lookup, so it is recorded as a memory context lookup.',
  })
  @IsOptional()
  @IsUUID()
  runId?: string;
}

export class BugHunterMemoryHitDto {
  @ApiProperty() id!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ type: [String] }) tags!: string[];
  @ApiProperty({ type: [String], nullable: true }) repos!: string[] | null;
  @ApiProperty() pinned!: boolean;
  @ApiProperty({ description: 'Cosine similarity to the query, 0-1.' })
  similarity!: number;
}

export class BugHunterMemorySearchResponseDto {
  @ApiProperty({ type: [BugHunterMemoryHitDto] })
  hits!: BugHunterMemoryHitDto[];
}

export class BugHunterMemoryEntryDto {
  @ApiProperty() id!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ type: [String] }) tags!: string[];
  @ApiProperty({ type: [String], nullable: true }) repos!: string[] | null;
  @ApiProperty() status!: string;
  @ApiProperty() pinned!: boolean;
  @ApiProperty() sourceCount!: number;
  @ApiProperty() timesApplied!: number;
  @ApiProperty() timesContradicted!: number;
  @ApiProperty({ nullable: true }) runId!: string | null;
  @ApiProperty({ nullable: true }) findingId!: string | null;
  @ApiProperty({ nullable: true }) createdBy!: number | null;
  @ApiProperty() embeddingStatus!: string;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ nullable: true }) lastAppliedAt!: Date | null;
  /** When it left the active set; null while active. */
  @ApiProperty({ nullable: true }) retiredAt!: Date | null;
  /** The admin who retired it, or null when the agent's own pass did. */
  @ApiProperty({ nullable: true }) retiredBy!: number | null;
  /** The agent's reason, in its own words, when it retired the entry itself. */
  @ApiProperty({ nullable: true }) retiredReason!: string | null;
}

export class ListBugHunterMemoryResponseDto {
  @ApiProperty({ type: [BugHunterMemoryEntryDto] })
  items!: BugHunterMemoryEntryDto[];
}

/**
 * A run's verdict on the notebook entries it read (OPP-0752). `applied` are the
 * ids that changed what the run did; `contradicted` the ones that turned out
 * wrong tonight. Both may be empty — an empty report is still a report, and is
 * what lets the nightly retirement pass trust a zero.
 */
export class BugHunterMemoryFeedbackDto {
  @ApiProperty({ description: 'The run reporting.' })
  @IsUUID()
  runId!: string;

  @ApiProperty({
    type: [String],
    description: 'Entry ids that changed what this run did.',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  applied!: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Entry ids that proved wrong during this run.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  contradicted?: string[];
}
