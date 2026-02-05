export type MetadataShape = {
  title?: string;
  description?: string;
  tone?: string;
  personality?: string;
  context?: string;
  openingStatements?: string[];
  sexualOrientation?: string;
  genderIdentity?: string;
  customFields?: { name: string; value: string }[];
  stateInstructions?: {
    instructions: string;
    dialogues: string[];
  };
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
