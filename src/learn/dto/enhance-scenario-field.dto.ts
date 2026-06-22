import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { EnhanceableField } from '../enum/enhanceable-field.enum';

export class EnhanceScenarioFieldDto {
  @ApiProperty({
    description: 'Which scenario field is being enhanced',
    enum: EnhanceableField,
    example: EnhanceableField.CHARACTER_PROFILE_TEXT,
  })
  @IsEnum(EnhanceableField)
  @IsNotEmpty()
  fieldName!: EnhanceableField;

  @ApiProperty({
    description:
      'The existing content of the field that should be improved. Enhance ' +
      'works only from this value — no other scenario fields are sent. ' +
      'Multi-line fields (e.g. opening dialogues) are newline-joined. The ' +
      'state field sends a JSON string {"name","guidelines"}.',
  })
  @IsString()
  @IsNotEmpty()
  currentValue!: string;

  @ApiProperty({
    description:
      'How to improve it — free-text custom guidance. Omit / empty for an ' +
      '"auto-improve" (improve overall quality with no specific direction).',
    required: false,
  })
  @IsString()
  @IsOptional()
  guidance?: string;

  @ApiProperty({
    description: 'Model override (e.g. gpt-4o, claude-sonnet-4-6)',
    required: false,
  })
  @IsString()
  @IsOptional()
  model?: string;

  @ApiProperty({
    description: 'AI provider to use',
    enum: ['openai', 'anthropic'],
    required: false,
    default: 'openai',
  })
  @IsEnum(['openai', 'anthropic'])
  @IsOptional()
  provider?: 'openai' | 'anthropic';
}

export class EnhanceScenarioFieldResponseDto {
  @ApiProperty({
    description: 'The field that was enhanced',
    enum: EnhanceableField,
  })
  fieldName!: EnhanceableField;

  @ApiProperty({
    description:
      'The improved content as plain text. Multi-line fields keep their line ' +
      'structure. The state field returns a JSON string {"name","guidelines"}.',
  })
  content!: string;
}
