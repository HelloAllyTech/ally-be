export type GenerateSummaryRequest = {
  chat_history: MessageRequest[];
  prompts?: Record<string, string>;
};

export type MessageRequest = {
  role: string;
  content: string;
  start_time?: number;
  end_time?: number;
};

export type EnhanceTextRequest = {
  content: string;
  prompts?: Record<string, string>;
};

export type Chat = {
  role: string;
  content: string;
};

export type IdentifySpeakersRequest = {
  chat_history: Chat[];
  prompts?: Record<string, string>;
};

export type TagPositivityRatingsRequest = {
  tags: string[];
  prompts?: Record<string, string>;
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
  prompts?: Record<string, string>;
}

export interface ScenarioReportGenerateRequest {
  prompt: string;
  turns: number;
  language: string;
  scenario_id: number;
  report_id: string;
  metadata: Record<string, any>;
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
  prompts?: Record<string, string>;
  enable_recommendations?: boolean;
};
