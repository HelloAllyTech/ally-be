import { Scenarios } from '../entity/scenarios.entity';
import { TriggerWarnings } from '../entity/trigger-warnings.entity';

export interface GetScenarioResponse extends Scenarios {
  triggerWarnings?: TriggerWarnings[];
}
