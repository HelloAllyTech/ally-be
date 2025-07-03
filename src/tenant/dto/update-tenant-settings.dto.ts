import { IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateTenantSettingsDto {
  @ApiProperty({ description: 'New settings for the tenant' })
  @IsObject()
  settings!: Record<string, any>;
}
