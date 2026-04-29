import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateTooltipDto {
  @ApiProperty({
    description: 'UI location identifier where the tooltip will appear',
    example: 'Login Button',
  })
  @IsString()
  @IsNotEmpty()
  location!: string;

  @ApiProperty({
    description: 'Tooltip text content shown to the user (max 200 characters)',
    example: 'Click here to sign in to your account',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  tipText!: string;

  @ApiProperty({
    description: 'Unicode emoji icon associated with the tooltip',
    example: '💡',
    required: false,
  })
  @IsString()
  @IsOptional()
  icon?: string;

  @ApiProperty({
    description: 'Whether the tooltip is active and visible to users',
    example: false,
    required: false,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  active?: boolean = false;
}
