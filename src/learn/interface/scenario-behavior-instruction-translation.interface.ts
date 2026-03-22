import { BehaviorStateInstruction } from '../type/scenario-behavior-instructions.type';

export interface CreateScenarioBehaviorInstructionTranslation {
  scenarioBehaviorInstructionId: string;
  languageId: number;
  // FEATURE_CLEANUP(FEATURE_SCENARIO_BEHAVIOR_STATE_INSTRUCTIONS): Remove instructions field
  instructions: string[];
  stateInstructions: BehaviorStateInstruction[];
}

export interface UpdateScenarioBehaviorInstructionTranslation extends CreateScenarioBehaviorInstructionTranslation {}
