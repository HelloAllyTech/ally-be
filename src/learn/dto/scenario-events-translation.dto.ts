import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, IsOptional } from 'class-validator';

export class CreateScenarioEventsTranslationDto {
  @ApiProperty({
    description: 'ID of the scenario',
    example: 1,
  })
  @IsNumber()
  scenarioId!: number;

  @ApiProperty({
    description: 'ID of the event',
    example: 'event1',
  })
  @IsString()
  eventId!: string;

  @ApiProperty({
    description: 'ID of the language',
    example: 1,
  })
  @IsNumber()
  languageId!: number;

  @ApiProperty({
    description: 'Translated message',
    example: 'This is a translated message',
    required: false,
  })
  @IsString()
  @IsOptional()
  message?: string;

  @ApiProperty({
    description: 'Branch instruction for the translation',
    example: 'Continue to next step',
    required: false,
  })
  @IsString()
  @IsOptional()
  branchInstruction?: string;
}

export class UpdateScenarioEventsTranslationDto {
  @ApiProperty({
    description: 'ID of the scenario',
    example: 1,
  })
  @IsNumber()
  scenarioId!: number;

  @ApiProperty({
    description: 'ID of the event',
    example: 'event1',
  })
  @IsString()
  eventId!: string;

  @ApiProperty({
    description: 'ID of the language',
    example: 1,
  })
  @IsNumber()
  languageId!: number;

  @ApiProperty({
    description: 'Translated message',
    example: 'Updated translated message',
    required: false,
  })
  @IsString()
  @IsOptional()
  message?: string;

  @ApiProperty({
    description: 'Branch instruction for the translation',
    example: 'Updated branch instruction',
    required: false,
  })
  @IsString()
  @IsOptional()
  branchInstruction?: string;
}
