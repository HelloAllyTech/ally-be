import { SCENARIO_DIFFICULTY_STATE_MAP } from '../constants/scenario-states.constants';
import { ScenarioStateConfig } from '../type/scenario-state.type';
import { ScenarioDifficultyLevel } from '../type/scenario.type';

/**
 * Formats state instructions by enriching them with score ranges from state config.
 * @param metadata - Scenario metadata containing stateInstructions
 * @param difficultyLevel - Scenario difficulty level
 * @returns Formatted state instructions with score ranges
 */
export const getScenarioStateConfigByDifficultyLevel = (
  difficulty: ScenarioDifficultyLevel,
): ScenarioStateConfig[] => {
  return SCENARIO_DIFFICULTY_STATE_MAP[difficulty];
};
