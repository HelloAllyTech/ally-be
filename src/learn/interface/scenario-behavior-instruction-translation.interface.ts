export interface CreateScenarioBehaviorInstructionTranslation {
  scenarioBehaviorInstructionId: string;
  languageId: number;
  instructions: string[];
}

export interface UpdateScenarioBehaviorInstructionTranslation extends CreateScenarioBehaviorInstructionTranslation {}
