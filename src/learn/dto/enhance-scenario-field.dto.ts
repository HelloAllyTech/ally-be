import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EnhanceableField } from '../enum/enhanceable-field.enum';

/**
 * A language to re-translate the improved (primary-language) content into.
 * Used by primary+translation fields (Challenge Description, Opening Dialogues)
 * so improving the source language refreshes every translation in one step.
 */
export class EnhanceTranslateTargetDto {
  @ApiProperty({ description: 'Scenario language id (keys the returned map)' })
  @IsString()
  @IsNotEmpty()
  languageId!: string;

  @ApiProperty({ description: 'Language code, e.g. hi-IN' })
  @IsString()
  @IsNotEmpty()
  languageCode!: string;
}

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

  @ApiProperty({
    description:
      'When set (primary+translation fields only), re-translate the improved ' +
      'content into these languages and return them in `translations`. Ignored ' +
      'for the structured state field.',
    type: [EnhanceTranslateTargetDto],
    required: false,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EnhanceTranslateTargetDto)
  @IsOptional()
  translateTo?: EnhanceTranslateTargetDto[];
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

  @ApiProperty({
    description:
      'Translations of the improved content, keyed by languageId — present ' +
      'only when `translateTo` was supplied.',
    required: false,
  })
  translations?: Record<string, string>;
}
