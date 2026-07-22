import { ScenarioStateInstruction } from './scenario-state.type';

export type MetadataShape = {
  title?: string;
  description?: string;
  context?: string;
  /** Primary language openings live on scenario.metadata; non-primary rows use this on scenario_translations only (not filled by bulk auto-translate). */
  openingStatements?: string[];
  /** Primary language reminders live on scenario.metadata; non-primary rows use this on scenario_translations, and are also mirrored into scenarios.translations for learner-runtime lookup. */
  reminders?: string[];
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
  profession: string;
  context: string;
  age: string;
  gender: string;
};

export type TriggerWarningTranslatableFields = {
  name: string;
};
