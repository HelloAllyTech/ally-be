import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsObject, IsNumber } from 'class-validator';

export class CreateScenarioVoiceDto {
  @ApiProperty({
    description: 'Name of the scenario voice',
    example: 'Scenario Voice 1',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description: 'Provider of the scenario voice',
    example: 'OpenAI',
  })
  @IsString()
  @IsNotEmpty()
  provider!: string;

  @ApiProperty({
    description: 'Config of the scenario voice',
    example: {
      voiceId: '123',
      model: 'gpt-4o-mini',
    },
  })
  @IsObject()
  @IsNotEmpty()
  config!: Record<string, any>;

  @ApiProperty({
    description: 'Language ID for the scenario voice',
    example: 1,
  })
  @IsNumber()
  @IsNotEmpty()
  languageId!: number;
}
