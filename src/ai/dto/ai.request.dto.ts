export type GenerateSummaryRequest = {
  chat_history: MessageRequest[];
};

export type MessageRequest = {
  role: string;
  content: string;
  timestamp?: string;
};

export type EnhanceTextRequest = {
  content: string;
};

export type Chat = {
  role: string;
  content: string;
};

export type IdentifySpeakersRequest = {
  chat_history: Chat[];
};

export type TagPositivityRatingsRequest = {
  tags: string[];
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
