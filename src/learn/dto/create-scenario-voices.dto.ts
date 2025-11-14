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
      },
      {
        name: 'Scenario Voice 2',
        provider: 'Deepgram',
        config: {
          voiceId: '456',
        },
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateScenarioVoiceDto)
  voices!: CreateScenarioVoiceDto[];
}
