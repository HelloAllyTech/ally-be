import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import {
  UxSignalScanStatus,
  UxSignalScanTrigger,
} from '../enum/ux-signal.enum';

/** What a scan did, as the admin surface reports it. */
export class UxScanOutcomeDto {
  @ApiProperty({ format: 'uuid' })
  scanId!: string;

  @ApiProperty({
    description:
      'Observations that crossed a detector threshold, before triage clustered them.',
  })
  signalsDetected!: number;

  @ApiProperty({ description: 'Bug findings filed into the Bug Hunter queue.' })
  findingsCreated!: number;

  @ApiProperty({
    description: 'Suggestions filed into the Analytics Suggestions queue.',
  })
  suggestionsCreated!: number;

  @ApiProperty({
    description:
      'Items already open as a finding or pending as a suggestion. A healthy ' +
      'steady state, not an error: a scan that detected nine signals and filed ' +
      'nothing because all nine were already known is working correctly.',
  })
  skippedDuplicates!: number;

  @ApiProperty({
    type: [String],
    description:
      'Detectors whose query failed, by name. Reported rather than hidden so a ' +
      'scan that found little can be told apart from one that could not look.',
  })
  failedDetectors!: string[];
}

/** One row of the scan log. */
export class UxSignalScanDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: UxSignalScanTrigger })
  trigger!: UxSignalScanTrigger;

  @ApiProperty({ enum: UxSignalScanStatus })
  status!: UxSignalScanStatus;

  @ApiProperty() windowFrom!: string;
  @ApiProperty() windowTo!: string;
  @ApiProperty() signalsDetected!: number;
  @ApiProperty() findingsCreated!: number;
  @ApiProperty() suggestionsCreated!: number;
  @ApiProperty() skippedDuplicates!: number;

  @ApiPropertyOptional({ nullable: true })
  error?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Null for scheduled runs.',
  })
  startedBy?: number | null;

  @ApiProperty() startedAt!: Date;

  @ApiPropertyOptional({ nullable: true })
  finishedAt?: Date | null;
}

export class ListUxScansQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ListUxScansResponseDto {
  @ApiProperty({ type: [UxSignalScanDto] })
  scans!: UxSignalScanDto[];
}
