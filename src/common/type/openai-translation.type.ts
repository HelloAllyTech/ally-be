/**
 * Types for OpenAI-based translation service
 * Defines requests, responses, and configurations for LLM-based language generation
 */

/**
 * Options for OpenAI translation
 */
export type OpenAITranslateOptions = {
  chunkSize?: number; // number of strings per API request (default 100)
  concurrency?: number; // how many languages to translate in parallel (default: all)
  mimeType?: 'text/plain' | 'text/html';
  temperature?: number; // LLM temperature for response variability (default: 0.5)
  useCodeMixing?: boolean; // whether to use code-mixing strategy (default: true)
  preserveStructure?: boolean; // preserve JSON structure in output (default: true)
};

/**
 * Message for OpenAI API call
 */
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * OpenAI chat completion request format
 */
export interface OpenAITranslationRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature: number;
  max_tokens?: number;
  top_p?: number;
}

/**
 * OpenAI chat completion response format
 */
export interface OpenAITranslationResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Language configuration for natural code-mixed generation
 */
export interface LanguageConfig {
  code: string;
  nativeName: string;
  codeMixedName: string;
  toneGuideline: string;
  commonPreserveWords: string[];
}

/**
 * Result of a single string translation
 */
export interface TranslationResult {
  original: string;
  translated: string;
  language: string;
}

/**
 * Batch translation result
 */
export interface BatchTranslationResult {
  language: string;
  translations: TranslationResult[];
  success: boolean;
  error?: string;
}
