import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class EndScenarioSessionRequestBodyDto {
  @ApiProperty({
    description: 'Enable recommendations',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  enableRecommendations?: boolean;

  @ApiProperty({
    description:
      "Learner's global UI language code (ISO 639-1 like 'hi'/'mr'/'en', " +
      "possibly BCP-47 like 'hi-IN'). Forwarded to ally-ai scenario evaluation.",
    required: false,
    example: 'hi',
  })
  @IsString()
  @IsOptional()
  languageCode?: string;
}
