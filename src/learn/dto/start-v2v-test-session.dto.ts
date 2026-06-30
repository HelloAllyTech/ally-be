import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Min, Max } from 'class-validator';

export class StartV2VTestSessionDto {
  @ApiProperty({ description: 'Scenario ID', example: 1 })
  @IsNumber()
  scenarioId!: number;

  @ApiProperty({ description: 'Language ID', example: 1 })
  @IsNumber()
  languageId!: number;

  @ApiPropertyOptional({
    description:
      'Maximum number of learner-to-counselor exchanges before the test ends automatically.',
    example: 12,
    default: 12,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  maxExchanges?: number;
}
