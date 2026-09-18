import { Scenarios } from '../entity/scenarios.entity';
import { TriggerWarnings } from '../entity/trigger-warnings.entity';
import { ScenarioCompletionSummary } from './scenario-completion.interface';

export interface GetScenarioResponse extends Scenarios {
  triggerWarnings?: TriggerWarnings[];
  /**
   * Set only on authenticated detail requests (GetScenarioByIdOptions.
   * includeCompletion); absent on the @Public() endpoint.
   */
  completion?: ScenarioCompletionSummary | null;
}
