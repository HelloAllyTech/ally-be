import { ApiPropertyOptional } from '@nestjs/swagger';
import { Scenarios } from '../entity/scenarios.entity';
import { TriggerWarnings } from '../entity/trigger-warnings.entity';
import { BehaviorInstructionWithBehaviorsDto } from './behavior-instruction-response.dto';
import { CompetencyResponseDto } from './competency.dto';

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
}

export class GetScenarioDto extends Scenarios {
  triggerWarnings?: TriggerWarnings[];
}

export class GetScenarioDtoWithPagination {
  data!: GetScenarioDto[];
  count!: number;
}
