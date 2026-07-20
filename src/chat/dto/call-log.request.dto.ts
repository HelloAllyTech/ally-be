import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsDateString,
  IsEnum,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';

export enum CallLogSortBy {
  ID = 'id',
  COUNSELOR_NAME = 'counselorName',
  CLIENT_ID = 'clientId',
  CALL_DURATION = 'callDuration',
  START_DATE = 'startDate',
  QUALITY_SCORE = 'qualityScore',
  TAGS = 'tags',
  CREATED_AT = 'createdAt',
}

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

/**
 * One custom/default-field filter clause. `fieldDefinitionId` is a
 * CustomFieldDefinition id; `value` is interpreted per that definition's
 * fieldType (string for TEXT, id list for SELECT, [from,to] for NUMBER/DATE
 * ranges). Sent by the client as a JSON-encoded `fieldFilters` query param.
 */
export interface FieldFilter {
  fieldDefinitionId: string;
  value: string | string[];
}

export interface CallLogFilters {
  limit?: number;
  offset?: number;
  sortBy?: CallLogSortBy;
  order?: SortOrder;
  counselorName?: string;
  counselorIds?: string;
  startDate?: string;
  endDate?: string;
  minDuration?: number;
  maxDuration?: number;
  minQualityScore?: number;
  maxQualityScore?: number;
  tags?: string;
  archive?: string;
  callName?: string;
  fieldFilters?: FieldFilter[];
  /** Comma-separated ScribeSessionMode values (SCRIBE, DICTATION). */
  mode?: string;
  /** Comma-separated status groups (SUCCESS, PROCESSING, FAILED, NO_AUDIO). */
  status?: string;
  /** Comma-separated channel groups (LIVE, UPLOAD). */
  source?: string;
}

/**
 * The subset of built-in column filters shared by the scribe (call-logs) and
 * admin (call-logs-summary) endpoints, passed through from query params.
 */
export type BuiltInCallLogFilters = Pick<
  CallLogFilters,
  | 'startDate'
  | 'endDate'
  | 'minDuration'
  | 'maxDuration'
  | 'tags'
  | 'mode'
  | 'status'
  | 'source'
>;

export class CallLogRequestDto {
  @ApiProperty({ required: false, description: 'Number of records to return' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => parseInt(value))
  limit?: number;

  @ApiProperty({ required: false, description: 'Number of records to skip' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => parseInt(value))
  offset?: number;

  @ApiProperty({
    required: false,
    enum: CallLogSortBy,
    description: 'Field to sort by',
    default: CallLogSortBy.START_DATE,
  })
  @IsOptional()
  @IsEnum(CallLogSortBy)
  sortBy?: CallLogSortBy = CallLogSortBy.START_DATE;

  @ApiProperty({
    required: false,
    enum: SortOrder,
    description: 'Sort order',
    default: SortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(SortOrder)
  order?: SortOrder = SortOrder.DESC;

  @ApiProperty({
    required: false,
    description: 'Search by counselor name (partial match)',
    example: 'John',
  })
  @IsOptional()
  @IsString()
  counselorName?: string;

  @ApiProperty({
    required: false,
    description: 'Search by client ID',
    example: '123',
  })
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiProperty({
    required: false,
    description: 'Filter by start date (ISO string)',
    example: '2024-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({
    required: false,
    description: 'Filter by end date (ISO string)',
    example: '2024-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({
    required: false,
    description: 'Filter by minimum call duration in seconds',
    example: 300,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => parseInt(value))
  minDuration?: number;

  @ApiProperty({
    required: false,
    description: 'Filter by maximum call duration in seconds',
    example: 3600,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => parseInt(value))
  maxDuration?: number;

  @ApiProperty({
    required: false,
    description: 'Filter by minimum quality score',
    example: 7.5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  @Transform(({ value }) => parseFloat(value))
  minQualityScore?: number;

  @ApiProperty({
    required: false,
    description: 'Filter by maximum quality score',
    example: 9.5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  @Transform(({ value }) => parseFloat(value))
  maxQualityScore?: number;

  @ApiProperty({
    required: false,
    description: 'Filter by tags (comma-separated)',
    example: 'anxiety,depression',
  })
  @IsOptional()
  @IsString()
  tags?: string;
}
