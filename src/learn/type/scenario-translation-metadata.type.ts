export type MetadataShape = {
  title?: string;
  description?: string;
  tone?: string;
  emotionalNeeds?: string;
  lifeHistory?: string;
  personality?: string;
  coreMemories?: string;
  startingState?: string;
  agentGoal?: string;
  context?: string;
  sessionBehaviorGuidelines?: string;
  openingStatements?: string[];
  sexualOrientation?: string;
  genderIdentity?: string;
  customFields?: { name: string; value: string }[];
};
