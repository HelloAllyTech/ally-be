import { ScenarioStateInstruction } from './scenario-state.type';

export type MetadataShape = {
  title?: string;
  description?: string;
  tone?: string;
  personality?: string;
  context?: string;
  /** Primary language openings live on scenario.metadata; non-primary rows use this on scenario_translations only (not filled by bulk auto-translate). */
  openingStatements?: string[];
  sexualOrientation?: string;
  genderIdentity?: string;
  customFields?: {
    name: string;
    value: string;
    useInDefaultPrompt?: boolean;
  }[];
  stateInstructions?: ScenarioStateInstruction[];
  stateNames?: {
    stateId: string;
    name: string;
  }[];
};

export type TranslationConsiderableData = {
  currentLocation: string;
  lifeHistory: string;
  personality: string;
  coreMemories: string;
  profession: string;
  context: string;
  age: string;
  gender: string;
};

export type TriggerWarningTranslatableFields = {
  name: string;
};
