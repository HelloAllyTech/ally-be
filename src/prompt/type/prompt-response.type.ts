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
  /**
   * Whether the studio pickers offer this variant as a choice. False = hidden
   * from new selections only; scenarios already on it are unaffected, and this
   * row is still returned here so the studio can resolve its metadata.
   */
  visibleInStudio?: boolean;
  /** Opt-in: this English source is auto-translated (main_agent/branching only). */
  translationEnabled?: boolean;
  /** Count of languages whose translation is currently `ready` (for a coverage badge). */
  translationsReady?: number;
  /** When true, this prompt declares a States section; studio renders the state editor. */
  hasStates?: boolean;
  usesBlocks?: string[];
  /** Prompt-level LLM provider override ('openai' | 'gemini' | 'anthropic'). */
  provider?: string;
  /** Prompt-level LLM model override. */
  model?: string;
  /** Prompt-level LLM sampling temperature override (0–2). */
  temperature?: number;
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
  /** Whether the studio pickers offer this variant as a choice (see PromptResponse). */
  visibleInStudio?: boolean;
  hasStates?: boolean;
  usesBlocks?: string[];
  /** Prompt-level LLM provider override ('openai' | 'gemini' | 'anthropic'). */
  provider?: string;
  /** Prompt-level LLM model override. */
  model?: string;
  /** Prompt-level LLM sampling temperature override (0–2). */
  temperature?: number;
};

export type PromptsWithPromptCode = {
  prompt: string;
  promptCode: string;
  availableVariables?: AvailableVariableEntry[];
  hasStates?: boolean;
  /** Prompt-level LLM provider override; forwarded to the runtime. */
  provider?: string;
  /** Prompt-level LLM model override; forwarded to the runtime. */
  model?: string;
  /** Prompt-level LLM sampling temperature override (0–2); forwarded to the runtime. */
  temperature?: number;
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
