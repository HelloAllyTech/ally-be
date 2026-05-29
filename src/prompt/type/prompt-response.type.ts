import { AvailableVariableEntry } from '../entity/prompt.entity';

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
  /**
   * Variable placeholders for this prompt. May be either bare strings
   * (legacy) or `{ name, label?, required? }` objects. Studio readers
   * should normalize via `normalizeAvailableVariables`.
   */
  availableVariables?: AvailableVariableEntry[];
  isObsolete?: boolean;
  kind?: string;
  /** Role/category in the agent pipeline: 'main_agent' | 'branching' | 'multilingual'. */
  promptType?: string;
  /** When true, this prompt declares a States section; studio renders the state editor. */
  hasStates?: boolean;
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
  availableVariables?: AvailableVariableEntry[];
  isObsolete?: boolean;
  kind?: string;
  promptType?: string;
  hasStates?: boolean;
  usesBlocks?: string[];
};

export type PromptsWithPromptCode = {
  prompt: string;
  promptCode: string;
  availableVariables?: AvailableVariableEntry[];
  hasStates?: boolean;
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
