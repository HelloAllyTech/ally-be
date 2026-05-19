import {
  ScenarioTranslationAction,
  ScenarioTranslationStatus,
} from '../enum/scenario-translation.enum';

export interface ScenarioTranslationProgressPayload {
  jobId: string;
  scenarioId?: number;
  scenarioTitle?: string;
  action: ScenarioTranslationAction;
  status: ScenarioTranslationStatus;
  language?: string;
  completed: number;
  total: number;
  error?: string;
  emittedAt: string;
}
