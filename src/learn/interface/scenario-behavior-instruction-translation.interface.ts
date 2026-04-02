import { BehaviorStateInstruction } from '../type/scenario-behavior-instructions.type';

export interface CreateScenarioBehaviorInstructionTranslation {
  scenarioBehaviorInstructionId: string;
  languageId: number;
  stateInstructions: BehaviorStateInstruction[];
}

export interface UpdateScenarioBehaviorInstructionTranslation extends CreateScenarioBehaviorInstructionTranslation {}
