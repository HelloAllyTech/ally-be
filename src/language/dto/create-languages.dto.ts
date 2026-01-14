import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ValidateNested } from 'class-validator';
import { CreateLanguageDto } from './create-language.dto';
import { Type } from 'class-transformer';

export class CreateLanguagesDto {
  @ApiProperty({
    description: 'Array of langauges to create',
    type: [CreateLanguageDto],
    example: [
      {
        value: 'en-IN',
        label: 'English (India)',
        active: true,
        translationCode: 'en',
        llmProviderConfig: { provider: 'openai', config: { model: 'gpt-4' } },
        sttProviderConfig: {
          provider: 'google',
          config: { model: 'google-cloud-stt-basic' },
        },
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateLanguageDto)
  languages!: CreateLanguageDto[];
}
