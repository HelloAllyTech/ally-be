export type PromptResponse = {
  id: string;
  promptCode: string;
  name: string;
  description: string;
  category?: string;
  createdAt: Date;
  prompt: string;
  defaultPrompt?: string;
  useDashboardOverride?: boolean;
  availableVariables?: string[];
  isObsolete?: boolean;
  kind?: string;
  usesBlocks?: string[];
};

export type PromptDetailResponse = {
  id: string;
  promptCode: string;
  name: string;
  description: string;
  category?: string;
  currentVersion?: number;
  createdAt: Date;
  updatedAt: Date;
  prompt?: string;
  defaultPrompt?: string;
  useDashboardOverride?: boolean;
  availableVariables?: string[];
  isObsolete?: boolean;
  kind?: string;
  usesBlocks?: string[];
};

export type PromptsWithPromptCode = {
  prompt: string;
  promptCode: string;
  availableVariables?: string[];
};

export type PromptSearchOptions = {
  name?: string;
  description?: string;
  category?: string[];
  prompt?: string;
  promptCode?: string[];
  /** When set, fetches prompts where promptCode LIKE 'prefix%' (e.g. ally_ai_learn_) */
  promptCodePrefix?: string;
  /** When true, only include prompts with useDashboardOverride=true (dashboard-edited) */
  useDashboardOverrideOnly?: boolean;
};
