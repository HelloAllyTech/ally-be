import { IsBoolean, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateTooltipDto {
  @IsString()
  @IsNotEmpty()
  location!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  tipText!: string;

  @IsBoolean()
  active!: boolean;
}
