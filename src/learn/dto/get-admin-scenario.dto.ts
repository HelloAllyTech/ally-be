import { Scenarios } from '../entity/scenarios.entity';

class TerminationEventDto {
  eventId?: string;
  name?: string;
  autoTerminationStatus?: boolean;
  message?: string;
}

export class GetAdminScenarioDto extends Scenarios {
  terminationEvent?: TerminationEventDto;
}
