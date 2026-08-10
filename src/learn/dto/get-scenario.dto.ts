import { ApiPropertyOptional } from '@nestjs/swagger';
import { Scenarios } from '../entity/scenarios.entity';
import { TriggerWarnings } from '../entity/trigger-warnings.entity';
import { BehaviorInstructionWithBehaviorsDto } from './behavior-instruction-response.dto';
import { CompetencyResponseDto } from './competency.dto';
import { ScenarioCompletionSummary } from '../interface/scenario-completion.interface';

class TerminationEventDto {
  eventId?: string;
  name?: string;
  message?: string;
}

export class GetAdminScenarioDto extends Scenarios {
  behaviorInstructions?: BehaviorInstructionWithBehaviorsDto[];
  triggerWarnings?: TriggerWarnings[];
  terminationEvents?: TerminationEventDto[];
  competency?: CompetencyResponseDto;

  @ApiPropertyOptional({
    description:
      'Opening dialogue lines per non-primary language (scenario_translations.metadata.openingStatements), keyed by languageId string',
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  translationOpeningStatements?: Record<string, string[]>;

  @ApiPropertyOptional({
    description:
      'Language id whose opening dialogues are stored on scenario metadata (primary / English path)',
  })
  openingDialoguePrimaryLanguageId?: number | null;

  @ApiPropertyOptional({
    description:
      'Challenge description per non-primary language (scenario_translations.metadata.description), keyed by languageId string',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  translationDescription?: Record<string, string>;

  @ApiPropertyOptional({
    description:
      'Language id whose challenge description is the primary (stored on scenarios.description). Mirrors openingDialoguePrimaryLanguageId resolution.',
  })
  challengeDescriptionPrimaryLanguageId?: number | null;

  @ApiPropertyOptional({
    description:
      'Title per non-primary language (scenario_translations.metadata.title), keyed by languageId string',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  translationTitle?: Record<string, string>;

  @ApiPropertyOptional({
    description:
      'Reminders per non-primary language (scenario_translations.metadata.reminders), keyed by languageId string',
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  translationReminders?: Record<string, string[]>;

  @ApiPropertyOptional({
    description:
      'Language id whose reminders are stored on scenario metadata (primary / English path). Mirrors openingDialoguePrimaryLanguageId resolution.',
  })
  remindersPrimaryLanguageId?: number | null;
}

export class GetScenarioDto extends Scenarios {
  triggerWarnings?: TriggerWarnings[];
  availableLanguages?: Array<{
    language_id: number;
    label: string;
    value: string;
  }> | null;

  @ApiPropertyOptional({
    description:
      "The requesting learner's completion record for this scenario, or null if they have never completed it. Only populated on authenticated endpoints.",
    type: 'object',
    nullable: true,
    properties: {
      attemptCount: { type: 'number' },
      lastCompletedAt: { type: 'string', format: 'date-time' },
    },
  })
  completion?: ScenarioCompletionSummary | null;
}

export class GetScenarioDtoWithPagination {
  data!: GetScenarioDto[];
  count!: number;
}
