import {
  IsString,
  IsOptional,
  IsObject,
  Matches,
  Length,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class CreateTenantDto {
  @ApiProperty({ description: 'Name of the tenant' })
  @IsString()
  @Length(1, 100)
  @Matches(/^[a-zA-Z0-9\s-_]+$/, {
    message:
      'Name can only contain letters, numbers, spaces, hyphens, and underscores',
  })
  name!: string;

  @ApiProperty({ description: 'Unique code for the tenant' })
  @IsString()
  @Length(2, 20)
  @Matches(/^[a-zA-Z0-9-_]+$/, {
    message: 'Code can only contain letters, numbers, hyphens, and underscores',
  })
  @Transform(({ value }) => value?.toLowerCase())
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
