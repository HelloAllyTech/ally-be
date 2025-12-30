import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateScenarioVoiceDto } from './create-scenario-voice.dto';

export class CreateScenarioVoicesDto {
  @ApiProperty({
    description: 'Array of scenario voices to create',
    type: [CreateScenarioVoiceDto],
    example: [
      {
        name: 'Scenario Voice 1',
        provider: 'OpenAI',
        config: {
          voiceId: '123',
          model: 'gpt-4o-mini',
        },
        languageId: 1,
      },
      {
        name: 'Scenario Voice 2',
        provider: 'Deepgram',
        config: {
          voiceId: '456',
        },
        languageId: 2,
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateScenarioVoiceDto)
  voices!: CreateScenarioVoiceDto[];
}
