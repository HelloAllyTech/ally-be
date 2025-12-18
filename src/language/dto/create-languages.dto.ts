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
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateLanguagesDto)
  languages!: CreateLanguageDto[];
}
