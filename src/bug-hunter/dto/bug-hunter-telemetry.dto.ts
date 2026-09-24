import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  BugHuntLookupKind,
  BugHuntPhase,
  BugHuntPhaseEvent,
} from '../enum/bug-hunt-telemetry.enum';

/** Cap on the agent's one-line phase summary — a timeline note, not a report. */
const PHASE_SUMMARY_MAX = 300;

export class RecordBugHuntPhaseDto {
  @ApiProperty({ enum: BugHuntPhase })
  @IsEnum(BugHuntPhase)
  phase!: BugHuntPhase;

  @ApiProperty({ enum: BugHuntPhaseEvent })
  @IsEnum(BugHuntPhaseEvent)
  event!: BugHuntPhaseEvent;

  @ApiPropertyOptional({
    description:
      'One line on finish, e.g. "9 findings, 2 refuted". Ignored on start.',
    maxLength: PHASE_SUMMARY_MAX,
  })
  @IsOptional()
  @IsString()
  @MaxLength(PHASE_SUMMARY_MAX)
  summary?: string;

  @ApiPropertyOptional({
    type: Object,
    description: 'Small structured detail. Never raw log or PII content.',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/**
 * A lookup the agent performed itself — a memory search, a repo-map read —
 * that the server could not observe. The server-observed kinds (prod logs,
 * web errors, reported bugs, approved findings, known non-bugs) are recorded
 * automatically when `&runId=` is passed to their endpoints and need no
 * call here; posting one of those kinds would double-count it.
 */
export class RecordBugHuntLookupDto {
  @ApiProperty({ enum: BugHuntLookupKind })
  @IsEnum(BugHuntLookupKind)
  kind!: BugHuntLookupKind;

  @ApiProperty({ description: 'Items returned. Zero is a real result.' })
  @IsInt()
  @Min(0)
  itemCount!: number;

  @ApiPropertyOptional({
    description: 'Size of what came back, in characters.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  chars?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  latencyMs?: number;

  @ApiPropertyOptional({
    description: 'Top relevance score of a ranked lookup, 0-1.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  relevance?: number;

  @ApiPropertyOptional({
    description: 'How many of the returned items changed what you did.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  usedCount?: number;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/**
 * How much of the repo the agent was shown — the code half of context
 * breadth. The data half (logs, exceptions, reports) is recorded by the
 * server per lookup; only the agent knows what `git` gave it.
 */
export class RecordBugHuntContextDto {
  @ApiPropertyOptional({
    description: 'Whole-repo review rather than the recent diff.',
  })
  @IsOptional()
  @IsBoolean()
  deep?: boolean;

  @ApiPropertyOptional({ description: 'Commits in the reviewed range.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  commits?: number;

  @ApiPropertyOptional({ description: 'Files in scope for code review.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  filesInScope?: number;

  @ApiPropertyOptional({
    description: 'Changed (or, deep, total) lines in scope.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  linesInScope?: number;

  @ApiPropertyOptional({
    description:
      'Characters of standing context handed to the agent up front (CLAUDE.md, knowledge pack).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  packChars?: number;
}

export class BugHuntPhaseDto {
  @ApiProperty({ enum: BugHuntPhase }) phase!: BugHuntPhase;
  @ApiProperty() startedAt!: Date;
  @ApiProperty({ nullable: true }) finishedAt!: Date | null;
  @ApiProperty({ nullable: true }) durationMs!: number | null;
  @ApiProperty({ nullable: true }) summary!: string | null;
  @ApiProperty({ nullable: true, type: Object })
  metadata!: Record<string, any> | null;
}

export class BugHuntLookupDto {
  @ApiProperty({ enum: BugHuntLookupKind }) kind!: BugHuntLookupKind;
  @ApiProperty() itemCount!: number;
  @ApiProperty() chars!: number;
  @ApiProperty() latencyMs!: number;
  @ApiProperty({ nullable: true }) relevance!: number | null;
  @ApiProperty({ nullable: true }) usedCount!: number | null;
  @ApiProperty() at!: Date;
}

export class BugHuntBreadthDto {
  @ApiProperty({ nullable: true }) deep!: boolean | null;
  @ApiProperty({ nullable: true }) commits!: number | null;
  @ApiProperty({ nullable: true }) filesInScope!: number | null;
  @ApiProperty({ nullable: true }) linesInScope!: number | null;
  @ApiProperty({ nullable: true }) packChars!: number | null;
  @ApiProperty({ description: 'Sum of items over every lookup in the run.' })
  lookupItems!: number;
  @ApiProperty({
    description: 'Sum of characters over every lookup in the run.',
  })
  lookupChars!: number;
}

export class BugHuntRunTelemetryDto {
  @ApiProperty() runId!: string;
  @ApiProperty({ type: [BugHuntPhaseDto] }) phases!: BugHuntPhaseDto[];
  @ApiProperty({ type: [BugHuntLookupDto] }) lookups!: BugHuntLookupDto[];
  @ApiProperty({ type: BugHuntBreadthDto }) breadth!: BugHuntBreadthDto;
  @ApiProperty({ nullable: true }) totalInputTokens!: number | null;
  @ApiProperty({ nullable: true }) totalOutputTokens!: number | null;
  @ApiProperty({ nullable: true }) totalDurationMs!: number | null;
}

export class BugHuntPhaseStatsDto {
  @ApiProperty({ enum: BugHuntPhase }) phase!: BugHuntPhase;
  @ApiProperty() samples!: number;
  @ApiProperty() unfinished!: number;
  @ApiProperty({ nullable: true }) medianMs!: number | null;
  @ApiProperty({ nullable: true }) p90Ms!: number | null;
}

export class BugHuntLookupStatsDto {
  @ApiProperty({ enum: BugHuntLookupKind }) kind!: BugHuntLookupKind;
  @ApiProperty() calls!: number;
  @ApiProperty({ nullable: true }) hitRate!: number | null;
  @ApiProperty({ nullable: true }) medianLatencyMs!: number | null;
  @ApiProperty({ nullable: true }) avgItems!: number | null;
  @ApiProperty({ nullable: true }) avgChars!: number | null;
  @ApiProperty({ nullable: true }) avgRelevance!: number | null;
  @ApiProperty({ nullable: true }) usedShare!: number | null;
}

export class BugHuntBreadthStatsDto {
  @ApiProperty({
    description: 'Runs in the window that reported a code-scope summary.',
  })
  runsReporting!: number;
  @ApiProperty({ nullable: true }) avgFilesInScope!: number | null;
  @ApiProperty({ nullable: true }) avgLinesInScope!: number | null;
  @ApiProperty({ nullable: true }) avgCommits!: number | null;
  @ApiProperty({ nullable: true }) avgPackChars!: number | null;
  @ApiProperty({
    description: 'Share of reporting runs that were deep (whole-repo) sweeps.',
    nullable: true,
  })
  deepShare!: number | null;
}

export class BugHunterPipelineMetricsDto {
  @ApiProperty() windowDays!: number;
  @ApiProperty({ type: [BugHuntPhaseStatsDto] })
  phases!: BugHuntPhaseStatsDto[];
  @ApiProperty({ type: [BugHuntLookupStatsDto] })
  lookups!: BugHuntLookupStatsDto[];
  @ApiProperty({ type: BugHuntBreadthStatsDto })
  breadth!: BugHuntBreadthStatsDto;
  @ApiProperty() computedAt!: string;
}
