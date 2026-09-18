import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';

// Limit/offset are intentionally not range-validated here — an out-of-range
// value (e.g. limit > 200) is clamped server-side in ChangelogService rather
// than rejected, since this endpoint is public and unauthenticated callers
// shouldn't get a 400 for an overly generous page size.
export class GetPublicChangelogEntriesDto {
  @ApiPropertyOptional({
    description: 'Max entries to return (default 100, clamped to 200)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;

  @ApiPropertyOptional({ description: 'Number of entries to skip (default 0)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  offset?: number;
}
