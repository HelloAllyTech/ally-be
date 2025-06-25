import {
  FlattenedSummaryNotePayload,
  Tag,
} from '../../common/entities/type/call.details.type';

export type GenerateSummaryResponse = FlattenedSummaryNotePayload;

export type EnhanceTextResponse = {
  enhanced_content: string;
};

export type IdentifySpeakersResponse = {
  [key: string]: string;
};

export type TagPositivityRatingsResponse = {
  tags: Tag[];
};

export interface AddReferenceDocumentResponse {
  id: string;
  heading: string;
  content: string;
  category: string;
  tags?: string[];
  tenant_id: string;
}

export interface SearchReferenceDocumentResult {
  id: string;
  heading: string;
  content: string;
  category: string;
  tags: string[];
  tenant_id: string;
  score: number;
}

export interface SearchReferenceDocumentsResponse {
  documents: SearchReferenceDocumentResult[];
  total: number;
  limit: number;
  categories: Record<string, number>;
}

export interface UpdateReferenceDocumentResponse {
  id: string;
  heading: string;
  content: string;
  category: string;
  tags?: string[];
  tenant_id: string;
}

export interface GetReferenceDocumentResponse {
  id: string;
  heading: string;
  content: string;
  category: string;
  tags: string[];
  tenant_id: string;
}

export interface DeleteReferenceDocumentResponse {
  success: boolean;
}
