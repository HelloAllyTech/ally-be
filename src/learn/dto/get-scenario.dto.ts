import { Scenarios } from '../entity/scenarios.entity';
import { TriggerWarnings } from '../entity/trigger-warnings.entity';

class TerminationEventDto {
  eventId?: string;
  name?: string;
  message?: string;
}

export class GetAdminScenarioDto extends Scenarios {
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
