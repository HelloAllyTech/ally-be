import {
  BehaviorInstructionItem,
  KnowledgeSourceAutofillItem,
  SimulationStateAutofillItem,
  StateInstructionItem,
} from '../dto/generate-scenario-field-response.dto';
import { BehaviorResponseDto } from '../dto/behavior-response.dto';
import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';

export type BehaviorIdMapping = Map<number, BehaviorResponseDto>;

export interface BehaviorInstructionsWithStateNames {
  instructions: BehaviorInstructionItem[];
  stateNames: { stateId: string; name: string }[];
}

export type GeneratedContent =
  | string
  | string[]
  | StateInstructionItem[]
  | BehaviorInstructionItem[]
  | BehaviorInstructionsWithStateNames
  | SimulationStateAutofillItem[]
  | KnowledgeSourceAutofillItem[];

export interface BehaviorInstructionPreset {
  category: BehaviorInstructionCategory;
  behaviorName: string;
}

export type CompetencyBehaviorPresetMap = Record<
  string,
  BehaviorInstructionPreset[]
>;
