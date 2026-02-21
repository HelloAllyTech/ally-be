export type PromptResponse = {
  id: string;
  promptCode: string;
  name: string;
  description: string;
  createdAt: Date;
  prompt: string;
};

export type PromptDetailResponse = {
  id: string;
  promptCode: string;
  name: string;
  description: string;
  currentVersion?: number;
  createdAt: Date;
  updatedAt: Date;
  prompt?: string;
};

export type PromptsWithPromptCode = {
  prompt: string;
  promptCode: string;
};

export type PromptSearchOptions = {
  name?: string;
  description?: string;
  prompt?: string;
  promptCode?: string[];
  useCase?: string[];
};
