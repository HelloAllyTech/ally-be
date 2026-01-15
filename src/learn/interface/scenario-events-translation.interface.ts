export interface CreateScenarioEventsTranslation {
  scenarioId: number;
  eventId: string;
  languageId: number;
  message?: string;
  branchInstruction?: string;
}

export interface UpdateScenarioEventsTranslation extends CreateScenarioEventsTranslation {}

export interface ScenarioEventsTranslationData {
  message?: string;
  branchInstruction?: string;
}
