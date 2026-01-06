import { Scenarios } from '../entity/scenarios.entity';
import { TriggerWarnings } from '../entity/trigger-warnings.entity';

class TerminationEventDto {
  eventId?: string;
  name?: string;
  autoTerminationStatus?: boolean;
  message?: string;
}

export class GetAdminScenarioDto extends Scenarios {
  // FEATURE_CLEANUP(FEATURE_MULTIPLE_TERMINATION_EVENTS): Remove terminationEvent
  terminationEvent?: TerminationEventDto;
  triggerWarnings?: TriggerWarnings[];
  terminationEvents?: TerminationEventDto[];
}

export class GetScenarioDto extends Scenarios {
  triggerWarnings?: TriggerWarnings[];
}

export class GetScenarioDtoWithPagination {
  data!: GetScenarioDto[];
  count!: number;
}
