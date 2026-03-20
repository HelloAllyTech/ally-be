import { ScenarioDifficultyLevel } from './scenario.type';

export interface ScenarioStateInstruction {
  stateId: string;
  name?: string;
  instruction?: string;
  dialogues?: string[];
}

export interface ScoreRange {
  min?: number; // undefined means no minimum
  max?: number; // undefined means no maximum
}

export interface ScenarioStateConfig {
  stateId: string;
  scoreRange: ScoreRange;
  label: string;
}

export interface ScenarioDifficultyStateConfigMap {
  [ScenarioDifficultyLevel.EASY]: ScenarioStateConfig[];
  [ScenarioDifficultyLevel.MEDIUM]: ScenarioStateConfig[];
  [ScenarioDifficultyLevel.HARD]: ScenarioStateConfig[];
}
