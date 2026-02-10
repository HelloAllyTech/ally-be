import { ScenarioDifficultyStateConfigMap } from '../type/scenario-state.type';
import { ScenarioDifficultyLevel } from '../type/scenario.type';

export const SCENARIO_DIFFICULTY_STATE_MAP: ScenarioDifficultyStateConfigMap = {
  [ScenarioDifficultyLevel.EASY]: [
    {
      stateId: 1,
      scoreRange: { max: -50 },
      label: 'score is less than -50',
    },
    {
      stateId: 2,
      scoreRange: { min: -50, max: 20 },
      label: 'score is between -50 & +20',
    },
    {
      stateId: 3,
      scoreRange: { min: 20, max: 70 },
      label: 'score is between +20 & 70',
    },
    {
      stateId: 4,
      scoreRange: { min: 70 },
      label: 'score is greater than 70',
    },
  ],
  [ScenarioDifficultyLevel.MEDIUM]: [
    {
      stateId: 1,
      scoreRange: { max: -20 },
      label: 'score is less than -20',
    },
    {
      stateId: 2,
      scoreRange: { min: -20, max: 50 },
      label: 'score is between -20 & +50',
    },
    {
      stateId: 3,
      scoreRange: { min: 50, max: 100 },
      label: 'score is between +50 & 100',
    },
    {
      stateId: 4,
      scoreRange: { min: 100 },
      label: 'score is greater than 100',
    },
  ],
  [ScenarioDifficultyLevel.HARD]: [
    {
      stateId: 1,
      scoreRange: { max: -10 },
      label: 'score is less than -10',
    },
    {
      stateId: 2,
      scoreRange: { min: -10, max: 100 },
      label: 'score is between -10 & +100',
    },
    {
      stateId: 3,
      scoreRange: { min: 100, max: 200 },
      label: 'score is between +100 & 200',
    },
    {
      stateId: 4,
      scoreRange: { min: 200 },
      label: 'score is greater than 200',
    },
  ],
};
