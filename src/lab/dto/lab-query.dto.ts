import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, Max, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

/** Shared list/search/pagination query for AI Lab collections. */
export class LabListQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive search filter' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Max records to return', default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 100;

  @ApiPropertyOptional({ description: 'Records to skip', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

/** List query for values, optionally scoped to a single variable. */
export class LabValueListQueryDto extends LabListQueryDto {
  @ApiPropertyOptional({ description: 'Only return values for this variable' })
  @IsOptional()
  @IsUUID()
  variableId?: string;
}
