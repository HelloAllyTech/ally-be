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
}
