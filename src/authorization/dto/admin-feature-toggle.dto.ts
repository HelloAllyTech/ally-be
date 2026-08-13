import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsString,
  ValidateNested,
} from 'class-validator';

export class FeatureToggleUpdateDto {
  @ApiProperty({ example: 'ai_lab' })
  @IsString()
  featureKey!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  enabled!: boolean;
}

export class SetFeatureTogglesDto {
  @ApiProperty({ type: [FeatureToggleUpdateDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => FeatureToggleUpdateDto)
  toggles!: FeatureToggleUpdateDto[];
}
