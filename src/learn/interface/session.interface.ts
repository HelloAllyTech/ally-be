import { AvailableLanguageItem } from 'src/common/util/language-availability.util';
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
  /**
   * Whether the requesting learner may start this roleplay as a text chat:
   * their org has TEXT_CHAT_ROLEPLAY_ENABLED on AND the scenario offers it.
   * Set only on authenticated detail requests
   * (GetScenarioByIdOptions.includeTextChatAvailability). A hint for the UI —
   * session start re-checks both.
   */
  textChatAvailable?: boolean;
  /**
   * The languages this scenario has a voice for, in the same shape the
   * catalog list returns. Set only when GetScenarioByIdOptions.
   * includeAvailableLanguages is; null when no language is voiced.
   */
  availableLanguages?: AvailableLanguageItem[] | null;
}
