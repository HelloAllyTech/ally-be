import { BehaviorInstructionDto } from '../dto/behavior-instruction.dto';
import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';

export type ScenarioBehaviorInstructionRequest = {
  scenarioId: number;
  behaviorInstructions: BehaviorInstructionDto[];
};

export interface FormattedBehaviorInstructionForLivekit {
  category: BehaviorInstructionCategory;
  behaviors: string[];
  score: number;
  actorsResponses: string[];
  behaviorInstructionId: string;
}
