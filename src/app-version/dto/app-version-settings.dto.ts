import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateAppVersionSettingsDto {
  @ApiPropertyOptional({
    description: 'iOS minimum supported version',
    example: '1.0.0',
  })
  @IsString()
  @IsOptional()
  ios?: string;

  @ApiPropertyOptional({
    description: 'Android minimum supported version',
    example: '1.0.0',
  })
  @IsString()
  @IsOptional()
  android?: string;
}

export class UpdateAppVersionSettingsDto {
  @ApiPropertyOptional({
    description: 'iOS minimum supported version',
    example: '1.0.0',
  })
  @IsString()
  @IsOptional()
  ios?: string;

  @ApiPropertyOptional({
    description: 'Android minimum supported version',
    example: '1.0.0',
  })
  @IsString()
  @IsOptional()
  android?: string;
}
