import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateTooltipDto {
  @IsString()
  @IsNotEmpty()
  location!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  tipText!: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsBoolean()
  active!: boolean;
}
