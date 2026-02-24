import {
  BehaviorInstructionItem,
  StateInstructionItem,
} from '../dto/generate-scenario-field-response.dto';
import { BehaviorResponseDto } from '../dto/behavior-response.dto';

export type BehaviorIdMapping = Map<number, BehaviorResponseDto>;

export type GeneratedContent =
  | string
  | string[]
  | StateInstructionItem[]
  | BehaviorInstructionItem[];
