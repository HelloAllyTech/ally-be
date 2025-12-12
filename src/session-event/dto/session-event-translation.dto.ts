import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, IsObject, IsOptional } from 'class-validator';

export class CreateScenarioEventTranslationDto {
  @ApiProperty({
    description: 'ID of the session event',
    example: 1,
  })
  @IsString()
  sessionEventId!: string;

  @ApiProperty({
    description: 'ID of the language',
    example: 1,
  })
  @IsNumber()
  languageId!: number;

  @ApiProperty({
    description: 'Translated message',
    example: 'This is a translated message',
  })
  @IsString()
  message!: string;

  @ApiProperty({
    description: 'Branch instruction for the translation',
    example: 'Continue to next step',
  })
  @IsString()
  branchInstruction!: string;

  @ApiProperty({
    description: 'Additional detection data',
    example: { key: 'value' },
    required: false,
  })
  @IsObject()
  @IsOptional()
  detectionData?: Record<string, any>;
}

export class UpdateScenarioEventTranslationDto {
  @ApiProperty({
    description: 'ID of the session event',
    example: 1,
  })
  @IsString()
  sessionEventId!: string;

  @ApiProperty({
    description: 'ID of the language',
    example: 'c302e15e-a502-4fc3-938f-5313dea6d9e6',
  })
  @IsNumber()
  languageId!: number;

  @ApiProperty({
    description: 'Updated translated message',
    example: 'This is an updated translated message',
  })
  @IsString()
  message!: string;

  @ApiProperty({
    description: 'Updated branch instruction',
    example: 'Updated branch instruction',
  })
  @IsString()
  branchInstruction!: string;

  @ApiProperty({
    description: 'Updated detection data',
    example: { key: 'new value' },
    required: false,
  })
  @IsObject()
  @IsOptional()
  detectionData?: Record<string, any>;
}
