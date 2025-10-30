import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsUUID,
  IsArray,
} from 'class-validator';
import { ScenarioStatus } from '../enum/scenario.status.enum';
import { Gender, GenderIdentity, SexualOrientation } from '../enum/gender.enum';

export class UpdateScenarioDto {
  @ApiProperty({
    description: 'Title of the scenario',
    example: 'Scenario 1',
  })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({
    description: 'Description of the scenario',
    example: 'Description 1',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Cover image URL of the scenario',
    example: 'https://example.com/cover-image.png',
  })
  @IsString()
  @IsOptional()
  coverImageUrl?: string;

  @ApiProperty({
    description: 'Status of the scenario (only DRAFT or ACTIVE allowed)',
    example: 'ACTIVE',
    enum: [ScenarioStatus.DRAFT, ScenarioStatus.ACTIVE],
  })
  @IsEnum(ScenarioStatus)
  @IsOptional()
  status?: ScenarioStatus;

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
}
