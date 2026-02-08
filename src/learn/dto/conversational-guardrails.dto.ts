import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateConversationalGuardrailDto {
  @ApiProperty({
    description: 'Classification of helper dialogue',
    example: 'rude',
  })
  @IsNotEmpty()
  @IsString()
  helperDialogue!: string;

  @ApiProperty({
    description: 'Actor response prompt',
    example: 'why are you talking to me like that?',
  })
  @IsNotEmpty()
  @IsString()
  actorDialogue!: string;

  @ApiPropertyOptional({
    description: 'Whether the guardrail is active',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateConversationalGuardrailDto {
  @ApiPropertyOptional({
    description: 'Classification of helper dialogue',
    example: 'rude',
  })
  @IsOptional()
  @IsString()
  helperDialogue?: string;

  @ApiPropertyOptional({
    description: 'Actor response prompt',
    example: 'why are you talking to me like that?',
  })
  @IsOptional()
  @IsString()
  actorDialogue?: string;

  @ApiPropertyOptional({
    description: 'Whether the guardrail is active',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateConversationalGuardrailTranslationDto {
  @ApiProperty({
    description: 'ID of the guardrail to translate',
  })
  @IsNotEmpty()
  @IsString()
  guardrailId!: string;

  @ApiProperty({
    description: 'Language ID for the translation',
  })
  @IsNotEmpty()
  languageId!: number;

  @ApiProperty({
    description: 'Translated helper dialogue classification',
  })
  @IsNotEmpty()
  @IsString()
  helperDialogue!: string;

  @ApiProperty({
    description: 'Translated actor response prompt',
  })
  @IsNotEmpty()
  @IsString()
  actorDialogue!: string;
}

export class UpdateConversationalGuardrailTranslationDto {
  @ApiPropertyOptional({
    description: 'Translated helper dialogue classification',
  })
  @IsOptional()
  @IsString()
  helperDialogue?: string;

  @ApiPropertyOptional({
    description: 'Translated actor response prompt',
  })
  @IsOptional()
  @IsString()
  actorDialogue?: string;
}
