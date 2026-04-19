import {
  ExperienceMode,
  ScenarioDifficultyLevel,
  ScenarioResponseLength,
  ScenarioStatus,
} from '../../learn/type/scenario.type';
import { ScenarioPathStatus } from '../../scenario-path/type/scenario-paths.type';

export interface ScenarioBehaviorInstructionSeedRecord {
  category: string;
  stateInstructions?: Array<{
    stateId: string;
    instruction: string;
  }>;
  behaviors: string[];
}

export interface ScenarioSeedRecord {
  seedKey: string;
  title?: string;
  description?: string;
  coverImageUrl?: string | null;
  coverVideoUrl?: string | null;
  status: ScenarioStatus;
  isPublic?: boolean;
  isGlobal?: boolean;
  prompt?: string;
  difficultyLevel?: ScenarioDifficultyLevel;
  responseLength?: ScenarioResponseLength;
  name?: string;
  age?: number;
  gender?: string;
  genderIdentity?: string;
  sexualOrientation?: string;
  currentLocation?: string;
  profession?: string;
  personality?: string;
  tone?: string;
  openingStatements?: string[];
  translationOpeningStatements?: Record<string, string[]>;
  selectedLanguageIds?: number[];
  linguisticStyleSamples?: Record<string, string[]>;
  allowedFillerWords?: Record<string, string[]>;
  competencyName?: string;
  terminationEvents?: Array<{
    eventCode: string;
    message?: string;
  }>;
  triggerWarningNames?: string[];
  customFields?: Record<string, any>[];
  experienceMode?: ExperienceMode;
  checklistType?: string;
  timerMode?: boolean;
  maxTimeValue?: string;
  optGuardrails?: boolean;
  behaviorInstructions?: ScenarioBehaviorInstructionSeedRecord[];
  characterProfileText?: string;
  showScoreMeter?: boolean;
  currentState?: string;
  knowledgeSources?: Record<string, any>[];
  stateNames?: Array<{
    stateId: string;
    name: string;
  }>;
  tenantCodes?: string[];
}

export interface ScenarioPathSeedRecord {
  title?: string;
  description?: string;
  coverImageUrl?: string | null;
  isGlobal?: boolean;
  status: ScenarioPathStatus;
  scenarios: Array<{
    scenarioSeedKey: string;
    order: number;
    minimumScore?: number;
    messageTitle?: string;
    messageContent?: string;
  }>;
  tenantCodes?: string[];
}

export interface ScenarioPathwaySeedData {
  source: {
    generatedAt: string;
    database: string;
    scenarioCount: number;
    pathCount: number;
  };
  scenarios: ScenarioSeedRecord[];
  paths: ScenarioPathSeedRecord[];
}
