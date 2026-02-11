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
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

import {
  ScenarioDifficultyLevel,
  ScenarioResponseLength,
  ScenarioStatus,
  ExperienceMode,
  ChecklistType,
} from '../type/scenario.type';
import { Gender, GenderIdentity, SexualOrientation } from '../enum/gender.enum';
import { CustomFieldsDto } from './custom-fields.dto';
import {
  MAX_CUSTOM_FIELDS_COUNT,
  MAX_TERMINATION_EVENT_COUNT,
} from '../constants/scenario.constants';
import { TerminationEventsDto } from './termination-events.dto';
import { StateInstructionsDto } from './state-instructions.dto';

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
    description: 'Personality of the AI client persona',
    example: 'Extraverted, anxious, open to new experiences, honest',
  })
  @IsString()
  @IsOptional()
  personality?: string;

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

  // FEATURE_CLEANUP(FEATURE_SCENARIO_STATE_INSTRUCTIONS): remove agentDialogues, context
  @ApiProperty({
    description: 'Your dialogues',
    example: ['Absolutely', 'Probably'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  agentDialogues?: string[];

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

  @ApiProperty({
    description: 'Experience mode for the scenario',
    enum: ExperienceMode,
    example: ExperienceMode.FEEDBACK,
    required: false,
  })
  @IsEnum(ExperienceMode)
  experienceMode?: ExperienceMode;

  @ApiProperty({
    description: 'Checklist type (required when experienceMode is CHECKLIST)',
    enum: ChecklistType,
    example: ChecklistType.GUIDED,
    required: false,
  })
  @IsEnum(ChecklistType)
  @ValidateIf((o) => o.experienceMode === ExperienceMode.CHECKLIST)
  @IsNotEmpty()
  checklistType?: ChecklistType;

  @ApiProperty({
    description:
      'Timer mode for the scenario, to show timer during the session.',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  timerMode?: boolean;

  @ApiProperty({
    description:
      'Maximum time value for the scenario timer (required when timerMode is true)',
    example: '1:30:00',
    required: false,
  })
  @ValidateIf((o) => o.timerMode === true)
  @IsNotEmpty()
  @IsString()
  maxTimeValue?: string;

  @ApiProperty({
    description: 'State instructions',
    type: [StateInstructionsDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StateInstructionsDto)
  stateInstructions?: StateInstructionsDto[];
}
