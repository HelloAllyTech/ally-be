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
  MaxLength,
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
  MAX_KNOWLEDGE_SOURCES_COUNT,
  MAX_TERMINATION_EVENT_COUNT,
} from '../constants/scenario.constants';
import { TerminationEventsDto } from './termination-events.dto';
import { BehaviorInstructionDto } from './behavior-instruction.dto';
import { MAX_BEHAVIOR_INSTRUCTIONS_COUNT } from '../constants/scenario-behavior-instuctions.constants';
import { KnowledgeSourceDto } from './knowledge-source.dto';
import { StateNamesDto } from './state-names.dto';
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
    description: 'Sample utterances per language for linguistic style',
    example: { '1': ['Sample 1', 'Sample 2'] },
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  @IsObject()
  @IsOptional()
  linguisticStyleSamples?: Record<string, string[]>;

  @ApiProperty({
    description:
      'Per-language allowed discourse fillers for the voice agent (native script preferred)',
    example: { '2': ['അങ്ങനെയൊന്നു', 'എന്തോ'] },
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  @IsObject()
  @IsOptional()
  allowedFillerWords?: Record<string, string[]>;

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
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  profession!: string;

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
    description:
      'Opening dialogue lines for non-primary languages (scenario_translations), keyed by languageId string',
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  @IsObject()
  @IsOptional()
  translationOpeningStatements?: Record<string, string[]>;

  @ApiProperty({
    description:
      'Challenge description text for non-primary languages (scenario_translations.metadata.description), keyed by languageId string',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsObject()
  @IsOptional()
  translationDescription?: Record<string, string>;

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

  @IsOptional()
  @ApiProperty({
    description: 'Experience mode for the scenario',
    enum: ExperienceMode,
    example: ExperienceMode.FEEDBACK,
    required: false,
  })
  @IsEnum(ExperienceMode)
  @ValidateIf((o) => o.experienceMode !== undefined)
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
    description: 'Enable conversational guardrails for the scenario',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  optGuardrails?: boolean;

  @ApiProperty({
    description: 'Behavior instructions',
    type: [BehaviorInstructionDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_BEHAVIOR_INSTRUCTIONS_COUNT)
  @ValidateNested({ each: true })
  @Type(() => BehaviorInstructionDto)
  behaviorInstructions?: BehaviorInstructionDto[];

  @ApiProperty({
    description: 'Character profile text',
    example: 'A detailed character profile...',
    required: false,
    maxLength: 2500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2500)
  characterProfileText?: string;

  @ApiProperty({
    description: 'Show score meter',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  showScoreMeter?: boolean;

  @ApiProperty({
    description: 'Enable current state for the scenario',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  currentState?: boolean;

  @ApiProperty({
    description: 'Competency ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  competencyId?: string;

  @ApiProperty({
    description: 'Knowledge sources',
    example: [
      {
        id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Knowledge source 1',
        content: 'Knowledge source content 1',
      },
      {
        id: '123e4567-e89b-12d3-a456-426614174001',
        title: 'Knowledge source 2',
        content: 'Knowledge source content 2',
      },
    ],
    type: [KnowledgeSourceDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_KNOWLEDGE_SOURCES_COUNT)
  @ValidateNested({ each: true })
  @Type(() => KnowledgeSourceDto)
  knowledgeSources?: KnowledgeSourceDto[];

  @ApiProperty({
    description: 'State names map',
    example: [
      {
        stateId: '1',
        name: 'name for state 1',
      },
    ],
    type: [StateNamesDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StateNamesDto)
  stateNames?: StateNamesDto[];
}
