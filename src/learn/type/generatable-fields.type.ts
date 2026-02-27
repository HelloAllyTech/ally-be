import {
  BehaviorInstructionItem,
  StateInstructionItem,
} from '../dto/generate-scenario-field-response.dto';
import { BehaviorResponseDto } from '../dto/behavior-response.dto';
import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';

export type BehaviorIdMapping = Map<number, BehaviorResponseDto>;

export type GeneratedContent =
  | string
  | string[]
  | StateInstructionItem[]
  | BehaviorInstructionItem[];

export interface BehaviorInstructionPreset {
  category: BehaviorInstructionCategory;
  behaviorName: string;
}

export type CompetencyBehaviorPresetMap = Record<
  string,
  BehaviorInstructionPreset[]
>;
