import { ScenarioStateInstruction } from './scenario-state.type';

export type MetadataShape = {
  title?: string;
  description?: string;
  tone?: string;
  personality?: string;
  context?: string;
  openingStatements?: string[];
  sexualOrientation?: string;
  genderIdentity?: string;
  customFields?: { name: string; value: string; isEnabled?: boolean }[];
  stateInstructions?: ScenarioStateInstruction[];
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
