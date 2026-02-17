import { BehaviorInstructionWithBehaviorsDto } from '../dto/behavior-instruction-response.dto';
import { BehaviorResponseDto } from '../dto/behavior-response.dto';
import { Behavior } from '../entity/behavior.entity';
import { ScenarioBehaviorInstructionBehavior } from '../entity/scenario-behavior-instruction-behavior.entity';
import { ScenarioBehaviorInstruction } from '../entity/scenario-behavior-instruction.entity';

export const formattedScenarioBehaviorInstructionsResponse = ({
  behaviorInstructions,
  behaviorMappings,
  behaviors,
}: {
  behaviorInstructions: ScenarioBehaviorInstruction[];
  behaviorMappings: ScenarioBehaviorInstructionBehavior[];
  behaviors: Behavior[];
}): BehaviorInstructionWithBehaviorsDto[] => {
  const behaviorMap = new Map<string, { id: string; name: string }>();
  behaviors.forEach((behavior) => {
    behaviorMap.set(behavior.id, {
      id: behavior.id,
      name: behavior.name,
    });
  });

  // Map of instructionId -> behaviorIds for quick lookup
  const instructionBehaviorMap = new Map<string, string[]>();
  behaviorMappings.forEach((mapping) => {
    const existing =
      instructionBehaviorMap.get(mapping.scenarioBehaviorInstructionId) || [];
    existing.push(mapping.behaviorId);
    instructionBehaviorMap.set(mapping.scenarioBehaviorInstructionId, existing);
  });

  // Combine instructions with their behaviors
  const instructionsWithBehaviors: BehaviorInstructionWithBehaviorsDto[] =
    behaviorInstructions.map((instruction) => {
      const behaviorIdsForInstruction =
        instructionBehaviorMap.get(instruction.id) || [];
      const behaviorsForInstruction = behaviorIdsForInstruction
        .map((behaviorId) => behaviorMap.get(behaviorId))
        .filter((behavior): behavior is BehaviorResponseDto => !!behavior);

      return {
        id: instruction.id,
        category: instruction.category,
        instructions: instruction.instructions,
        behaviors: behaviorsForInstruction,
      };
    });

  return instructionsWithBehaviors;
};
