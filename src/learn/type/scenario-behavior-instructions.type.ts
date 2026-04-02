import { BehaviorInstructionDto } from '../dto/behavior-instruction.dto';
import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';

export type ScenarioBehaviorInstructionRequest = {
  scenarioId: number;
  behaviorInstructions?: BehaviorInstructionDto[];
};

export interface FormattedBehaviorInstructionForLivekit {
  category: BehaviorInstructionCategory;
  behaviors: string[];
  score: number;
  actorsResponses?: string[];
  behaviorInstructionId: string;
  stateMatchedInstructions?: BehaviorStateInstruction[];
}

export interface MergedBehaviorInstructions {
  behaviors: string[] | undefined;
  id: string;
  scenarioId: number;
  category: BehaviorInstructionCategory;
  stateInstructions?: BehaviorStateInstruction[];
}

export interface BehaviorMappingRequestType {
  scenarioId: number;
  existingInstructionIds: string[];
  createdInstructions: MergedBehaviorInstructions[];
  updatedInstructions: BehaviorInstructionDto[];
  removedInstructionIds: string[];
}

export interface BehaviorStateInstruction {
  stateId: string;
  instruction: string;
}
