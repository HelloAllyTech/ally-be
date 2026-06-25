import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ScenarioSessionStatus } from '../../learn/enum/scenario-session-status.enum';
import { SortOrder } from '../../common/type/common.type';

/**
 * Columns a super-admin may sort the roleplay-session-logs list by. Whitelisted
 * (never raw user input interpolated into SQL) — the repository maps each to a
 * concrete column.
 */
export enum RoleplaySessionLogSortBy {
  CREATED_AT = 'createdAt',
  STARTED_AT = 'startedAt',
  ENDED_AT = 'endedAt',
  SCORE = 'score',
  STATUS = 'status',
}

export class ListRoleplaySessionLogsQueryDto {
  @ApiProperty({ required: false, default: 25, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiProperty({ required: false, default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiProperty({
    required: false,
    description:
      'Free-text search over user name, user email and scenario title',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ required: false, enum: ScenarioSessionStatus })
  @IsOptional()
  @IsEnum(ScenarioSessionStatus)
  status?: ScenarioSessionStatus;

  @ApiProperty({
    required: false,
    description:
      'Inclusive lower bound (ISO date/datetime) on the session start',
  })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiProperty({
    required: false,
    description:
      'Exclusive-end (ISO date/datetime) upper bound on the session start',
  })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiProperty({
    required: false,
    description: 'Restrict to a single organization (tenant id)',
  })
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiProperty({
    required: false,
    enum: RoleplaySessionLogSortBy,
    default: RoleplaySessionLogSortBy.CREATED_AT,
  })
  @IsOptional()
  @IsEnum(RoleplaySessionLogSortBy)
  sortBy?: RoleplaySessionLogSortBy;

  @ApiProperty({ required: false, enum: SortOrder, default: SortOrder.DESC })
  @IsOptional()
  @IsEnum(SortOrder)
  order?: SortOrder;
}

export class RoleplaySessionLogRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() counselorId!: number;
  @ApiProperty({ nullable: true }) counselorName!: string | null;
  @ApiProperty({ nullable: true }) counselorEmail!: string | null;
  @ApiProperty() tenantId!: string;
  @ApiProperty({ nullable: true }) orgName!: string | null;
  @ApiProperty() scenarioId!: number;
  @ApiProperty({ nullable: true }) scenarioTitle!: string | null;
  @ApiProperty({ enum: ScenarioSessionStatus }) status!: ScenarioSessionStatus;
  @ApiProperty({ nullable: true }) startedAt!: Date | null;
  @ApiProperty({ nullable: true }) endedAt!: Date | null;
  @ApiProperty({ nullable: true, description: 'Effective duration in seconds' })
  durationSeconds!: number | null;
  @ApiProperty({ nullable: true }) score!: number | null;
  @ApiProperty({ nullable: true }) platform!: string | null;
  @ApiProperty() createdAt!: Date;
}

export class ListRoleplaySessionLogsResponseDto {
  @ApiProperty({ type: [RoleplaySessionLogRowDto] })
  data!: RoleplaySessionLogRowDto[];

  @ApiProperty({
    description: 'Total rows matching the filters (ignores paging)',
  })
  total!: number;
}

export class RoleplaySessionLogEventDto {
  @ApiProperty() id!: string;
  @ApiProperty() eventId!: string;
  @ApiProperty({ nullable: true }) eventName!: string | null;
  @ApiProperty() occurredAt!: Date;
  @ApiProperty({ nullable: true }) score!: number | null;
  @ApiProperty({ nullable: true }) emoji!: string | null;
  @ApiProperty({ nullable: true }) message!: string | null;
}

export class RoleplaySessionLogMessageDto {
  @ApiProperty() id!: number;
  @ApiProperty() senderId!: number;
  @ApiProperty() content!: string;
  @ApiProperty({ nullable: true }) startSeconds!: number | null;
  @ApiProperty({ nullable: true }) endSeconds!: number | null;
  @ApiProperty() createdAt!: Date;
}

export class RoleplaySessionLogDetailDto extends RoleplaySessionLogRowDto {
  @ApiProperty({ nullable: true, description: 'Post-session summary (jsonb)' })
  summary!: Record<string, any> | null;

  @ApiProperty({ type: [RoleplaySessionLogEventDto] })
  events!: RoleplaySessionLogEventDto[];

  @ApiProperty({ type: [RoleplaySessionLogMessageDto] })
  transcript!: RoleplaySessionLogMessageDto[];
}
