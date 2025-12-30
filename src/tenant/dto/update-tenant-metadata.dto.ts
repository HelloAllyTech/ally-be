import { IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateTenantMetadataDto {
  @ApiProperty({ description: 'New metadata for the tenant' })
  @IsObject()
  metadata!: Record<string, any>;
}
