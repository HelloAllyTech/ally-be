import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ScenarioReportConfig } from '../type/scenario-report-config.type';
import { UpdateScenarioReportTranscriptDto } from './scenario-report-transcript.dto';
import { ScenarioReportStatus } from '../enum/scenario-report.enum';

export class ScenarioReportLanguageDto {
  @IsNumber()
  @ApiProperty({
    description: 'ID of the language',
    example: 1,
  })
  id!: number;

  @IsString()
  @ApiProperty({
    description: 'Value of the language',
    example: 'en',
  })
  value!: string;

  @IsString()
  @ApiProperty({
    description: 'Label of the language',
    example: 'English',
  })
  label!: string;
}
export class CreateScenarioReportDto {
  @ApiProperty({ description: 'Language ID', required: true, example: 1 })
  @IsNumber()
  languageId!: number;

  @ApiProperty({ description: 'Turns', required: true, example: 5 })
  @IsNumber()
  turns!: number;

  @ApiProperty({ description: 'Helper agent prompt', required: true })
  @IsString()
  helperAgentPrompt!: string;
}

export class CreateScenarioReportResponseDto {
  @ApiProperty({
    description: 'ID of the scenario report',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    description: 'Status of the scenario report',
    example: ScenarioReportStatus.STARTED,
  })
  status!: ScenarioReportStatus;
}

export class UpdateScenarioReportDto {
  @ApiProperty({
    description: 'Metrics of the scenario report',
    required: false,
    example: { accuracy: 85, precision: 85 },
  })
  @IsOptional()
  @IsObject()
  metrics?: Record<string, number>;

  @ApiProperty({
    description: 'Status of the scenario report',
    required: false,
    enum: ScenarioReportStatus,
  })
  @IsOptional()
  @IsEnum(ScenarioReportStatus)
  status?: ScenarioReportStatus;

  @ApiProperty({
    description: 'Transcripts to append',
    type: [UpdateScenarioReportTranscriptDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateScenarioReportTranscriptDto)
  transcripts?: UpdateScenarioReportTranscriptDto[];
}

export class ScenarioReportDto {
  @ApiProperty({
    description: 'ID of the scenario report',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    description: 'ID of the scenario',
    example: 1,
  })
  scenarioId!: number;

  @ApiProperty({
    description: 'Scenario title',
    example: 'Scenario title',
  })
  scenarioTitle!: string;

  @ApiProperty({
    description: 'Config of the scenario report',
    example: {
      helperAgentPrompt: 'Helper agent prompt',
      languageId: 1,
      turns: 5,
    },
  })
  config!: ScenarioReportConfig;

  @ApiProperty({
    description: 'Metrics of the scenario report',
    example: {
      gradual_disclosure: 85,
      difficulty_level: 85,
      consistency: 85,
      colloquialism: 85,
      context_appropriateness: 85,
      resistance: 85,
    },
  })
  metrics?: Record<string, number>;

  @ApiProperty({
    description: 'Date when the scenario report was created',
    type: Date,
    example: '2026-02-04T11:47:56.722Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Date when the scenario report was last updated',
    type: Date,
    example: '2026-02-04T11:47:56.722Z',
  })
  updatedAt!: Date;

  @ApiProperty({
    description: 'Status of the scenario report',
    example: ScenarioReportStatus.COMPLETED,
  })
  status!: ScenarioReportStatus;

  @ApiProperty({
    description: 'ID of the user who created the scenario report',
    example: 1,
  })
  createdBy!: number;

  @ApiProperty({
    description: 'ID of the user who last updated the scenario report',
    example: 1,
  })
  updatedBy!: number;

  @ApiProperty({
    description: 'Language of the scenario report',
    example: { id: 1, value: 'en', label: 'English' },
  })
  language?: ScenarioReportLanguageDto;
}

export class ScenarioReportResponseDto {
  @ApiProperty({ type: [ScenarioReportDto] })
  data!: ScenarioReportDto[];

  @ApiProperty({ example: 1 })
  count!: number;
}
