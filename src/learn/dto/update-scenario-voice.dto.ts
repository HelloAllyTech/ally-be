import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsObject, IsNumber } from 'class-validator';

export class UpdateScenarioVoiceDto {
  @ApiProperty({
    description: 'Name of the scenario voice',
    example: 'Scenario Voice 1',
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description: 'Provider of the scenario voice',
    example: 'OpenAI',
  })
  @IsString()
  @IsOptional()
  provider?: string;

  @ApiProperty({
    description: 'Config of the scenario voice',
    example: {
      voiceId: '123',
    },
  })
  @IsObject()
  @IsOptional()
  config?: Record<string, any>;

  @ApiProperty({
    description: 'Language ID for the scenario voice',
    example: 1,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  languageId?: number;
}
