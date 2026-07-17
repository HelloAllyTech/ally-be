import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';

/**
 * Competency → default behaviour-instruction presets. Used to seed the
 * behaviour table when an author picks a competency (see
 * competency-behavior-instruction-templates.constants). This is the only
 * surviving part of the old generatable-fields types after the
 * generate/regenerate feature was removed.
 */
export interface BehaviorInstructionPreset {
  category: BehaviorInstructionCategory;
  behaviorName: string;
}

export type CompetencyBehaviorPresetMap = Record<
  string,
  BehaviorInstructionPreset[]
>;
