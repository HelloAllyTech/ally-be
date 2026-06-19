import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { GeneratableField } from '../enum/generatable-field.enum';
import { ScenarioDifficultyLevel } from '../type/scenario.type';

export class ScenarioFieldContextDto {
  @ApiProperty({ description: 'Title of the scenario', required: true })
  @IsString()
  title!: string;

  @ApiProperty({
    description: 'Name of the AI client persona',
    required: false,
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ description: 'Age of the AI client persona', required: false })
  @IsNumber()
  @IsOptional()
  age?: number;

  @ApiProperty({
    description: 'Gender of the AI client persona',
    required: false,
  })
  @IsString()
  @IsOptional()
  gender?: string;

  @ApiProperty({
    description: 'Gender identity of the AI client persona',
    required: false,
  })
  @IsString()
  @IsOptional()
  genderIdentity?: string;

  @ApiProperty({
    description: 'Sexual orientation of the AI client persona',
    required: false,
  })
  @IsString()
  @IsOptional()
  sexualOrientation?: string;

  @ApiProperty({
    description: 'Profession of the AI client persona',
    required: false,
  })
  @IsString()
  @IsOptional()
  profession?: string;

  @ApiProperty({
    description: 'Current location of the AI client persona',
    required: false,
  })
  @IsString()
  @IsOptional()
  currentLocation?: string;

  @ApiProperty({
    description: 'Competency being practiced in the scenario',
    required: false,
  })
  @IsString()
  @IsOptional()
  competency?: string;

  @ApiProperty({
    description: 'Difficulty level of the scenario',
    example: ScenarioDifficultyLevel.EASY,
    enum: ScenarioDifficultyLevel,
  })
  @IsEnum(ScenarioDifficultyLevel)
  @IsOptional()
  difficultyLevel?: ScenarioDifficultyLevel;

  @ApiProperty({
    description: 'Character profile text of the AI client persona',
    required: false,
  })
  @IsString()
  @IsOptional()
  characterProfileText?: string;

  @ApiProperty({
    description: 'Challenge description of the scenario',
    required: false,
  })
  @IsString()
  @IsOptional()
  challengeDescription?: string;

  @ApiHideProperty()
  @IsString()
  @IsOptional()
  allowedHelperBehaviorsList?: string;

  @ApiHideProperty()
  @IsString()
  @IsOptional()
  predefinedBehaviorInstructionsDoc?: string;

  @ApiProperty({
    description: 'Language ID (required for linguistic style samples)',
    required: false,
  })
  @IsString()
  @IsOptional()
  languageId?: string;

  @ApiProperty({
    description:
      'Language code e.g. hi-IN, ml-IN (required for linguistic style samples)',
    required: false,
  })
  @IsString()
  @IsOptional()
  languageCode?: string;

  @ApiProperty({
    description:
      'Language name e.g. Hindi, Malayalam (required for linguistic style samples)',
    required: false,
  })
  @IsString()
  @IsOptional()
  languageName?: string;

  @ApiProperty({
    description:
      'Number of states to generate (only used by GeneratableField.STATES). ' +
      'The studio sends the count of state cards currently on screen so the ' +
      'LLM produces exactly that many.',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  numStates?: number;

  @ApiProperty({
    description:
      'Stringified JSON of existing filled states (only used by ' +
      'GeneratableField.STATES). When the user has some filled state cards ' +
      'and asks to generate, this lets the LLM produce complementary states ' +
      "that don't duplicate names / overlap ranges.",
    required: false,
  })
  @IsString()
  @IsOptional()
  existingStates?: string;

  @ApiProperty({
    description:
      'Number of knowledge source documents to generate (only used by ' +
      'GeneratableField.KNOWLEDGE_SOURCES). Studio sends current count of ' +
      'cards on screen so the LLM produces exactly that many.',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  numKnowledgeSources?: number;

  @ApiProperty({
    description:
      'Stringified JSON of existing filled knowledge source titles (only ' +
      'used by GeneratableField.KNOWLEDGE_SOURCES). Lets the LLM avoid ' +
      'duplicating titles already in the form.',
    required: false,
  })
  @IsString()
  @IsOptional()
  existingKnowledgeSources?: string;

  @ApiProperty({
    description:
      'Current value of the field being regenerated, serialized as text. ' +
      'Set on Copilot refinement rounds (round >= 2) so the LLM revises the ' +
      'existing value instead of starting from scratch. Omitted on a fresh ' +
      'generation.',
    required: false,
  })
  @IsString()
  @IsOptional()
  currentValue?: string;

  @ApiProperty({
    description:
      'Evaluation feedback (the practice-conversation report) the LLM should ' +
      'address when revising the current value. Set on Copilot refinement ' +
      'rounds; omitted on a fresh generation.',
    required: false,
  })
  @IsString()
  @IsOptional()
  improvementRecommendation?: string;
}

export class GenerateScenarioFieldDto {
  @ApiProperty({
    description: 'The scenario field to auto-generate content for',
    enum: GeneratableField,
    example: GeneratableField.CHARACTER_PROFILE_TEXT,
  })
  @IsEnum(GeneratableField)
  @IsNotEmpty()
  fieldName!: GeneratableField;

  @ApiProperty({
    description: 'Existing scenario data used as context for generation',
    type: ScenarioFieldContextDto,
    required: true,
  })
  @ValidateNested()
  @Type(() => ScenarioFieldContextDto)
  scenarioContext!: ScenarioFieldContextDto;

  @ApiProperty({
    description:
      'Model override for generation (e.g. gpt-4o, claude-sonnet-4-6)',
    required: false,
  })
  @IsString()
  @IsOptional()
  model?: string;

  @ApiProperty({
    description: 'AI provider to use for generation',
    enum: ['openai', 'anthropic'],
    required: false,
    default: 'openai',
  })
  @IsEnum(['openai', 'anthropic'])
  @IsOptional()
  provider?: 'openai' | 'anthropic';
}
