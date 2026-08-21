import { ScribeSessionMode } from 'src/common/constants/chat.constants';
import { WorkerType } from 'src/user/enum/user.enum';

export type PromptOverride =
  | string
  | {
      prompt: string;
      availableVariables?: (
        | string
        | { name: string; label?: string; required?: boolean }
      )[];
      /** Prompt-level LLM provider override, honored by ally-ai. */
      provider?: string;
      /** Prompt-level LLM model override (OpenAI/Gemini), honored by ally-ai. */
      model?: string;
      /** Prompt-level LLM sampling temperature override (0–2), honored by ally-ai. */
      temperature?: number;
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
  /**
   * CLIENT turns only: the learner talked over this reply, so `content` holds
   * only the part that reached TTS before it stopped — a PREFIX of what the
   * model produced, not the whole utterance. Measured across judged turns, a cut
   * turn keeps ~36% of the generated characters against ~107% on an uncut one.
   *
   * Undefined means unknown — an older worker, or a COUNSELOR turn — and is
   * deliberately distinct from false, which is a worker that looked and found
   * the turn completed.
   */
  interrupted?: boolean;
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
  /**
   * The learner's worker type. Sets the register, depth and expectations of the
   * supervisor note only — never the skill_coverage scores, which stay on one
   * fixed standard so they remain comparable across an organisation.
   * Unset falls back to LAY on the ally-ai side.
   */
  worker_type?: WorkerType | null;
  /** The learner's first name, so the note can address them directly. */
  learner_name?: string | null;
  /**
   * What the supervisor carries forward about THIS LEARNER from previous
   * debriefs. Distinct from `previous_memory`, which is about the client/case.
   */
  supervisor_memory?: string | null;
  /**
   * Behaviours this specific scenario is configured to reward (its
   * SHOULD_DO behavior instructions). Additional scenario-specific context
   * for message_tags and the supervisor note — never the skill_coverage
   * scores, which stay on one fixed standard.
   */
  helpful_behaviours?: string[];
  /**
   * Behaviours this specific scenario is configured to flag (its
   * SHOULD_NOT_DO behavior instructions). Same scope as `helpful_behaviours`.
   */
  unhelpful_behaviours?: string[];
};

// ── Product Roadmap semantic duplicate detection (ally-ai / Weaviate) ────────
// snake_case on the wire, matching the reference-document precedent.

/**
 * Upsert one opportunity's vector. The Weaviate object uuid IS `opportunity_id`, so this is
 * idempotent by construction and there is no create/update split.
 *
 * NOTE the description is sent for EMBEDDING only — ally-ai does not persist it. Duplicating
 * opportunity text into Weaviate would need a write on every description edit, and any missed
 * write would feed a stale description into the LLM's duplicate judgement. ally-be already has
 * every description in hand when it runs that step.
 */
export interface RoadmapOpportunityUpsertRequest {
  opportunity_id: string;
  description: string;
  product_goal: string;
}

export interface RoadmapOpportunityBulkUpsertRequest {
  items: RoadmapOpportunityUpsertRequest[];
}

export interface RoadmapSimilarOpportunitiesRequest {
  description: string;
  /** Optional scoping to one product goal. */
  product_goal?: string;
  /** Default 20 (source: match_count). */
  limit?: number;
  /**
   * Default 0.5. Calibrated for Voyage voyage-3-large at 1024 dimensions in the standalone
   * app; needs re-calibrating for OpenAI text-embedding-3-small at 1536.
   */
  threshold?: number;
}
