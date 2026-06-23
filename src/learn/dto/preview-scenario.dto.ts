import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsUUID } from 'class-validator';

export class PreviewScenarioDto {
  @ApiProperty({
    description: 'Scenario ID',
    example: 1,
  })
  @IsNumber()
  scenarioId!: number;

  @ApiProperty({
    description: 'Language ID',
    example: 1,
  })
  @IsNumber()
  languageId!: number;

  @ApiPropertyOptional({
    description:
      'Scenario version to preview. When set, the preview runs that version’s ' +
      '(possibly unpublished draft) config instead of the live scenario.',
  })
  @IsOptional()
  @IsUUID()
  scenarioVersionId?: string;
}
