import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsUUID,
  IsArray,
  IsBoolean,
  ValidateNested,
  IsObject,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

import {
  ScenarioDifficultyLevel,
  ScenarioResponseLength,
  ScenarioStatus,
} from '../type/scenario.type';
import { Gender, GenderIdentity, SexualOrientation } from '../enum/gender.enum';
import { CustomFieldsDto } from './custom-fields.dto';
import {
  MAX_CUSTOM_FIELDS_COUNT,
  MAX_TERMINATION_EVENT_COUNT,
} from '../constants/scenario.constants';
import { TerminationEventsDto } from './termination-events.dto';

export class CreateScenarioDto {
  @ApiProperty({
    description: 'Title of the scenario',
    example: 'Scenario 1',
  })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({
    description: 'Learning goal of the scenario',
    example: 'Description 1',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Mapping of language IDs to voice IDs',
    example: { '1': '0000000-1111-2222-3333-444444444444' },
    type: 'object',
    additionalProperties: { type: 'string', format: 'uuid' },
  })
  @IsObject()
  @IsOptional()
  languageVoices?: Record<string, string>;

  @ApiProperty({
    description: 'Cover image URL of the scenario',
    example: 'https://example.com/cover-image.png',
  })
  @IsString()
  @IsOptional()
  coverImageUrl?: string;

  @ApiProperty({
    description: 'Cover video URL of the scenario',
    example: 'https://example.com/cover-video.mp4',
  })
  @IsString()
  @IsOptional()
  coverVideoUrl?: string;

  @ApiProperty({
    description: 'Status of the scenario',
    example: ScenarioStatus.DRAFT,
    enum: ScenarioStatus,
  })
  @IsEnum(ScenarioStatus)
  @IsNotEmpty()
  status!: ScenarioStatus;

  @ApiProperty({
    description: 'Is the scenario public',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiProperty({
    description: 'Prompt of the scenario',
    example: 'Prompt 1',
  })
  @IsString()
  @IsOptional()
  prompt?: string;

  @ApiProperty({
    description: 'Agent goal for the scenario',
    example: 'Goal to generate the summary',
  })
  @IsString()
  @IsOptional()
  agentGoal?: string;

  @ApiProperty({
    description: 'Name of the AI client persona',
    example: 'Ahana',
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description: 'Age of the AI client persona',
    example: 16,
  })
  @IsNumber()
  @IsOptional()
  age?: number;

  @ApiProperty({
    description: 'Gender of the AI client persona',
    example: Gender.FEMALE,
    enum: Gender,
  })
  @IsEnum(Gender)
  @IsOptional()
  gender?: Gender;

  @ApiProperty({
    description: 'Gender identity of the AI client persona',
    example: GenderIdentity.FEMALE_WOMAN,
    enum: GenderIdentity,
  })
  @IsEnum(GenderIdentity)
  @IsOptional()
  genderIdentity?: GenderIdentity;

  @ApiProperty({
    description: 'Sexual orientation of the AI client persona',
    example: SexualOrientation.HETEROSEXUAL,
    enum: SexualOrientation,
  })
  @IsEnum(SexualOrientation)
  @IsOptional()
  sexualOrientation?: SexualOrientation;

  @ApiProperty({
    description: 'Current location of the AI client persona',
    example: 'Kolkata, India',
  })
  @IsString()
  @IsOptional()
  currentLocation?: string;

  @ApiProperty({
    description: 'Profession of the AI client persona',
    example: 'Student',
  })
  @IsString()
  @IsOptional()
  profession?: string;

  @ApiProperty({
    description: 'Context of the AI client persona',
    example: 'Context of the AI client persona',
  })
  @IsString()
  @IsOptional()
  context?: string;

  @ApiProperty({
    description: 'Session behavior guidelines of the AI client persona',
    example: 'Session behavior guidelines of the AI client persona',
  })
  @IsString()
  @IsOptional()
  sessionBehaviorGuidelines?: string;

  @ApiProperty({
    description: 'Life history of the AI client persona',
    example: 'Life history of the AI client persona',
  })
  @IsString()
  @IsOptional()
  lifeHistory?: string;

  @ApiProperty({
    description: 'Core memories of the AI client persona',
    example: 'Core memories of the AI client persona',
  })
  @IsString()
  @IsOptional()
  coreMemories?: string;

  @ApiProperty({
    description: 'Personality of the AI client persona',
    example: 'Extraverted, anxious, open to new experiences, honest',
  })
  @IsString()
  @IsOptional()
  personality?: string;

  @ApiProperty({
    description: 'Starting state of the AI client persona',
    example: 'Scared, hopeless',
  })
  @IsString()
  @IsOptional()
  startingState?: string;

  // FEATURE_CLEANUP(FEATURE_SCENARIO_CUSTOM_FIELDS): Remove coreMemories, lifeHistory, startingState, emotionalNeeds, sessionBehaviorGuidelines, agentGoal
  @ApiProperty({
    description: 'Difficulty level of the scenario',
    example: ScenarioDifficultyLevel.EASY,
    enum: ScenarioDifficultyLevel,
  })
  @IsEnum(ScenarioDifficultyLevel)
  @IsOptional()
  difficultyLevel?: ScenarioDifficultyLevel;

  @ApiProperty({
    description: 'Response length of the scenario',
    example: ScenarioResponseLength.VERY_BRIEF,
    enum: ScenarioResponseLength,
  })
  @IsEnum(ScenarioResponseLength)
  @IsOptional()
  responseLength?: ScenarioResponseLength;

  @ApiProperty({
    description: 'Your dialogues',
    example: ['Absolutely', 'Probably'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  agentDialogues?: string[];

  @ApiProperty({
    description: 'Emotional needs of the AI client persona',
    example: 'Emotional needs of the AI client persona',
  })
  @IsString()
  @IsOptional()
  emotionalNeeds?: string;

  @ApiProperty({
    description: 'Tone of the AI client persona',
    example: 'Casual',
  })
  @IsString()
  @IsOptional()
  tone?: string;

  @ApiProperty({
    description: 'Opening statements of the AI client persona',
    example: ['Hi, I need some help.', 'I am feeling down today.'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  openingStatements?: string[];

  @ApiProperty({
    description: 'Voice ID (UUID) of the AI client persona',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsOptional()
  voiceId?: string;

  // FEATURE_CLEANUP(FEATURE_MULTIPLE_TERMINATION_EVENTS): Remove single terminationEvent data
  @ApiProperty({
    description: 'AutoTermination status',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  autoTerminationStatus?: boolean;

  @ApiProperty({
    description: 'Termination message',
    example: 'Termination message',
  })
  @IsOptional()
  @IsString()
  terminationMessage?: string;

  @ApiProperty({
    description: 'Termination event ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  terminationEventId?: string;

  @ApiProperty({
    description: 'Termination events',
    example: [
      {
        id: '123e4567-e89b-12d3-a456-426614174000',
        message: 'Termination message',
      },
    ],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TERMINATION_EVENT_COUNT)
  @ValidateNested({ each: true })
  @Type(() => TerminationEventsDto)
  terminationEvents?: TerminationEventsDto[];

  @ApiProperty({ description: 'Global tenant visibility', example: false })
  isGlobal?: boolean;

  @ApiProperty({
    description: 'Trigger warning IDs',
    example: [
      '123e4567-e89b-12d3-a456-426614174000',
      '123e4567-e89b-12d3-a456-426614174001',
    ],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  triggerWarningIds?: string[];

  @ApiProperty({
    description: 'Custom fields',
    type: [CustomFieldsDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CUSTOM_FIELDS_COUNT)
  @ValidateNested({ each: true })
  @Type(() => CustomFieldsDto)
  customFields?: CustomFieldsDto[];
}
