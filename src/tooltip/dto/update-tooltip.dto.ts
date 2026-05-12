import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateTooltipDto {
  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tipText?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
