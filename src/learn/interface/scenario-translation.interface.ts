export interface CreateScenarioTranslation {
  scenarioId: number;
  languageId: number;
  metadata: Record<string, any>;
}

export interface UpdateScenarioTranslation extends CreateScenarioTranslation {}
