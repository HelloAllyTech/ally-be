import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import {
  UxSignalScanStatus,
  UxSignalScanTrigger,
} from '../enum/ux-signal.enum';

/**
 * The acknowledgement that a scan now exists and is running.
 *
 * Everything a caller needs to follow the run and nothing it has not earned yet:
 * there are no counts here, because at this moment there are none. A shape that
 * carried zeroes would be indistinguishable from a finished, quiet scan.
 */
export class UxScanStartedDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Poll GET /v1/ux-signals/scans and match on this id.',
  })
  scanId!: string;

  @ApiProperty({
    enum: UxSignalScanStatus,
    description: 'Always `running` — the scan is claimed before this returns.',
  })
  status!: UxSignalScanStatus;

  @ApiProperty()
  startedAt!: Date;
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

  @ApiProperty({
    type: [String],
    description:
      'Detectors whose query failed, by name. Lifted out of `metadata` and onto ' +
      'the row because this is how a finished scan reports itself now that the ' +
      'scan endpoint returns before there is anything to report.',
  })
  failedDetectors!: string[];

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
