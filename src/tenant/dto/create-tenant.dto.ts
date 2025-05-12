import { IsString, IsOptional, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTenantDto {
  @ApiProperty({ description: 'Name of the tenant' })
  @IsString()
  name!: string;

  @ApiProperty({ description: 'Unique code for the tenant' })
  @IsString()
  code!: string;

  @ApiProperty({ description: 'Description of the tenant', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Metadata for the tenant', required: false })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  @ApiProperty({ description: 'Settings for the tenant', required: false })
  @IsObject()
  @IsOptional()
  settings?: Record<string, any>;
}
