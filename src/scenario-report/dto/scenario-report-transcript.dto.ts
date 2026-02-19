import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString } from 'class-validator';

export class UpdateScenarioReportTranscriptDto {
  @ApiProperty({
    description: 'Content of the transcript',
    example: 'This is a test transcript',
  })
  @IsString()
  content!: string;

  @ApiProperty({
    description: 'Start time of the transcript in seconds',
    example: 0,
  })
  @IsNumber()
  start_time!: number;

  @ApiProperty({
    description: 'Role of the transcript owner',
    example: 'CLIENT',
  })
  @IsString()
  role!: string;
}

export class ScenarioReportTranscriptDto {
  @ApiProperty({
    description: 'ID of the transcript',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    description: 'ID of the scenario report',
    example: '4bad23d1-e034-43cb-ba63-f750ac722e70',
  })
  scenarioReportId!: string;

  @ApiProperty({
    description: 'Role of the transcript owner',
    example: 'CLIENT',
  })
  role!: string;

  @ApiProperty({
    description: 'Content of the transcript',
    example: 'This is a test transcript',
  })
  content!: string;

  @ApiProperty({
    description: 'Start time of the transcript',
    example: 0,
    nullable: true,
  })
  startSeconds?: number;

  @ApiProperty({
    description: 'Date when the transcript was created',
    type: Date,
    example: '2026-02-04T11:47:56.722Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Date when the transcript was last updated',
    type: Date,
    example: '2026-02-04T11:47:56.722Z',
  })
  updatedAt!: Date;
}

export class ScenarioReportTranscriptResponseDto {
  @ApiProperty({ type: [ScenarioReportTranscriptDto] })
  messages!: ScenarioReportTranscriptDto[];

  @ApiProperty({ example: 1 })
  count!: number;
}
