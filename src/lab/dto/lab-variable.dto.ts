import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

// Variable names are substituted into templates as `{{name}}`, so keep them to
// a template-safe identifier charset (letters, digits, underscore, dot, dash).
const VARIABLE_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
const VARIABLE_NAME_MESSAGE =
  'name may only contain letters, digits, underscore, dot or dash (no spaces)';

export class CreateLabVariableDto {
  @ApiProperty({
    description: 'Unique variable name, referenced in templates as {{name}}',
    example: 'customer_tone',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(VARIABLE_NAME_PATTERN, { message: VARIABLE_NAME_MESSAGE })
  name!: string;

  @ApiPropertyOptional({ description: 'What this variable represents' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateLabVariableDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(VARIABLE_NAME_PATTERN, { message: VARIABLE_NAME_MESSAGE })
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
