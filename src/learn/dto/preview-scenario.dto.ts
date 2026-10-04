import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsUUID } from 'class-validator';
import { ScenarioInteractionMode } from '../enum/scenario-interaction-mode.enum';

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

  @ApiPropertyOptional({
    description:
      'Preview as a VOICE call (default) or a TEXT chat. Unlike a learner ' +
      'start, a TEXT preview needs neither the org preference nor the ' +
      'scenario’s textChatEnabled: authors preview the text persona before ' +
      'deciding whether to offer it.',
    enum: ScenarioInteractionMode,
  })
  @IsOptional()
  @IsEnum(ScenarioInteractionMode)
  interactionMode?: ScenarioInteractionMode;
}
