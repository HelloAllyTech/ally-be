import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsString,
  IsOptional,
  IsNumber,
  Min,
  Max,
  MaxLength,
  IsEnum,
  MinLength,
  IsUrl,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  ScenarioCharacterSortBy,
  ScenarioCharacterSortOrder,
} from '../enum/scenario-character.enum';
import { TrimStringTransform } from 'src/common/util/string-transform.util';
import { CharacterKnowledgeSourceDto } from './character-knowledge-source.dto';
import {
  MAX_CHARACTER_KNOWLEDGE_SOURCES_COUNT,
  MAX_CHARACTER_LINGUISTIC_STYLE_SAMPLES_COUNT,
} from '../constants/scenario-character.constants';

export class ScenarioCharacterRequestDto {
  @ApiProperty({ description: 'Scenario character name' })
  @Transform(TrimStringTransform)
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ description: 'Scenario character age' })
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Max(150)
  age!: number;

  @ApiProperty({ description: 'Scenario character gender' })
  @Transform(TrimStringTransform)
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  gender!: string;

  @ApiProperty({
    description: 'Scenario character profession',
    required: true,
  })
  @IsNotEmpty()
  @Transform(TrimStringTransform)
  @IsString()
  @MaxLength(200)
  profession!: string;

  @ApiProperty({ description: 'Scenario character current location' })
  @Transform(TrimStringTransform)
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  currentLocation!: string;

  @ApiProperty({ description: 'Scenario character gender identity' })
  @Transform(TrimStringTransform)
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  genderIdentity!: string;

  @ApiProperty({ description: 'Scenario character sexual orientation' })
  @Transform(TrimStringTransform)
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  sexualOrientation!: string;

  @ApiProperty({
    description: 'URL of the character cover image',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsUrl()
  coverImageUrl?: string;

  @ApiProperty({
    description: 'URL of the character cover video',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsUrl()
  coverVideoUrl?: string;

  @ApiProperty({
    description: 'Character backstory / profile text',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2500)
  characterProfileText?: string;

  @ApiProperty({
    description:
      'ID of the voice (from the scenario voice library) assigned to this character',
    required: false,
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID()
  voiceId?: string;

  @ApiProperty({
    description:
      'Free-text style guidance for this character (e.g. dialect, register, code-mixing norms)',
    required: false,
    example:
      'Speaks simple, colloquial Chennai Tamil; code-mixes with English.',
  })
  @IsOptional()
  @Transform(TrimStringTransform)
  @IsString()
  @MaxLength(1000)
  languageCharacteristics?: string;

  @ApiProperty({
    description:
      "Sample utterances demonstrating the character's speech pattern",
    required: false,
    example: ['Aiyo, enna panna?', 'Sari sari, ippo varen.'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CHARACTER_LINGUISTIC_STYLE_SAMPLES_COUNT)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  linguisticStyleSamples?: string[];

  @ApiProperty({
    description: 'Knowledge sources this character can draw on',
    required: false,
    type: [CharacterKnowledgeSourceDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CHARACTER_KNOWLEDGE_SOURCES_COUNT)
  @ValidateNested({ each: true })
  @Type(() => CharacterKnowledgeSourceDto)
  knowledgeSources?: CharacterKnowledgeSourceDto[];
}

export class GetScenarioCharacterQueryDto {
  @ApiProperty({
    description:
      'Search query for scenario character name, profession, or location',
    required: false,
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({
    description: 'Number of records to return',
    required: false,
    default: 15,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 15;

  @ApiProperty({
    description: 'Number of records to skip',
    required: false,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  offset?: number = 0;

  @ApiProperty({
    description: 'Field to sort by (default: name)',
    required: false,
    enum: ScenarioCharacterSortBy,
  })
  @IsOptional()
  @IsEnum(ScenarioCharacterSortBy)
  sortBy?: ScenarioCharacterSortBy;

  @ApiProperty({
    description: 'Sort order (default: ASC)',
    required: false,
    enum: ScenarioCharacterSortOrder,
  })
  @IsOptional()
  @IsEnum(ScenarioCharacterSortOrder)
  sortOrder?: ScenarioCharacterSortOrder;
}

export class ScenarioCharacterResponseDto {
  @ApiProperty({ description: 'Scenario character ID' })
  id!: string;

  @ApiProperty({ description: 'Scenario character name' })
  name!: string;

  @ApiProperty({ description: 'Scenario character age' })
  age!: number;

  @ApiProperty({ description: 'Scenario character gender' })
  gender!: string;

  @ApiProperty({
    description: 'Scenario character profession',
    required: false,
  })
  profession?: string;

  @ApiProperty({ description: 'Scenario character current location' })
  currentLocation!: string;

  @ApiProperty({ description: 'Scenario character gender identity' })
  genderIdentity!: string;

  @ApiProperty({ description: 'Scenario character sexual orientation' })
  sexualOrientation!: string;

  @ApiProperty({
    description: 'URL of the character cover image',
    required: false,
  })
  coverImageUrl?: string;

  @ApiProperty({
    description: 'URL of the character cover video',
    required: false,
  })
  coverVideoUrl?: string;

  @ApiProperty({
    description: 'Character backstory / profile text',
    required: false,
  })
  characterProfileText?: string;

  @ApiProperty({
    description:
      'ID of the voice (from the scenario voice library) assigned to this character',
    required: false,
  })
  voiceId?: string;

  @ApiProperty({
    description:
      'Free-text style guidance for this character (e.g. dialect, register, code-mixing norms)',
    required: false,
  })
  languageCharacteristics?: string;

  @ApiProperty({
    description:
      "Sample utterances demonstrating the character's speech pattern",
    required: false,
    type: [String],
  })
  linguisticStyleSamples?: string[];

  @ApiProperty({
    description: 'Knowledge sources this character can draw on',
    required: false,
    type: [CharacterKnowledgeSourceDto],
  })
  knowledgeSources?: CharacterKnowledgeSourceDto[];

  @ApiProperty({ description: 'Created at' })
  createdAt!: Date;

  @ApiProperty({ description: 'Updated at' })
  updatedAt!: Date;
}

export class GetScenarioCharactersResponseDto {
  @ApiProperty({
    description: 'List of scenario characters',
    type: [ScenarioCharacterResponseDto],
  })
  characters!: ScenarioCharacterResponseDto[];

  @ApiProperty({ description: 'Total count of scenario characters' })
  count!: number;
}
