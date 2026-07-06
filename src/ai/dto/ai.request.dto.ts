import { ScribeSessionMode } from 'src/common/constants/chat.constants';

export type PromptOverride =
  | string
  | {
      prompt: string;
      availableVariables?: (
        | string
        | { name: string; label?: string; required?: boolean }
      )[];
    };

export type GenerateSummaryRequest = {
  chat_history: MessageRequest[];
  prompts?: Record<string, PromptOverride>;
  mode?: ScribeSessionMode;
  keys?: string[];
  key_descriptions?: Record<string, string>;
};

export type MessageRequest = {
  role: string;
  content: string;
  start_time?: number;
  end_time?: number;
};

export type EnhanceTextRequest = {
  content: string;
  prompts?: Record<string, PromptOverride>;
};

export type Chat = {
  role: string;
  content: string;
};

export type IdentifySpeakersRequest = {
  chat_history: Chat[];
  prompts?: Record<string, PromptOverride>;
};

export type TagPositivityRatingsRequest = {
  tags: string[];
  prompts?: Record<string, PromptOverride>;
};

export interface AddReferenceDocumentRequest {
  document_id: string;
  heading: string;
  content: string;
  category: string;
  tags?: string[];
  tenant_id: string;
}

export interface SearchReferenceDocumentsRequest {
  query: string;
  limit?: number;
  document_ids?: string[];
  filters?: {
    category?: string;
    tags?: string[];
    tenant_id?: string;
  };
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface UpdateReferenceDocumentRequest {
  heading?: string;
  content?: string;
  category?: string;
  tags?: string[];
}

export interface GetReferenceDocumentRequest {
  document_id: string;
}

export interface DeleteReferenceDocumentRequest {
  document_id: string;
}

export interface TranscribeAudioRequest {
  presigned_url: string;
  chat_id: number;
  sample_rate: number;
  prompts?: Record<string, PromptOverride>;
  mode?: ScribeSessionMode;
}

export interface ScenarioReportGenerateRequest {
  prompt: string;
  turns: number;
  language: string;
  scenario_id: number;
  report_id: string;
  metadata: Record<string, any>;
  // promptCode of the transcript-evaluator variant to run. When set, ai-learn
  // resolves the evaluator (LLM-judge) system prompt from this variant's
  // dashboard text instead of the default evaluator template. Undefined uses
  // the default evaluator.
  evaluator_prompt_code?: string;
}

/** One agent test case the actor is scored against (sent to the LLM judge). */
export interface ActorGoalEvaluationGoal {
  id: string;
  title: string;
  category: string;
  description?: string | null;
}

/** A single transcript turn for the actor evaluation. */
export interface ActorGoalEvaluationTurn {
  /** 'assistant' = the roleplay actor; 'user' = the trainee/counselor. */
  role: 'assistant' | 'user';
  content: string;
}

/**
 * Request to ai-learn to evaluate the roleplay ACTOR agent of a real session
 * against the configured agent test cases. ai-learn runs the LLM judge over
 * the transcript and webhooks per-goal scores + feedback back to ally-be.
 */
export interface ActorGoalEvaluationRequest {
  scenario_session_id: string;
  transcript: ActorGoalEvaluationTurn[];
  goals: ActorGoalEvaluationGoal[];
  /** Session language (id or code) for the judge prompt; optional. */
  language?: string;
}

export type ScenarioEvaluationChatMessage = {
  id: string;
  role: string;
  content: string;
  start_time?: number | null;
  end_time?: number | null;
};

export type ScenarioEvaluationRequest = {
  chat_history: ScenarioEvaluationChatMessage[];
  need_memory: boolean;
  previous_memory: string | null;
  memory_prompt: string | null;
  prompts?: Record<string, PromptOverride>;
  enable_recommendations?: boolean;
  language_code?: string | null;
};
