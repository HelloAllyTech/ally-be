import { BehaviorInstructionDto } from '../dto/behavior-instruction.dto';

export type ScenarioBehaviorInstructionRequest = {
  scenarioId: number;
  behaviorInstructions: BehaviorInstructionDto[];
};
