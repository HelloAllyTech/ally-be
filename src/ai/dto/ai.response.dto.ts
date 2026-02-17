import {
  FlattenedSummaryNotePayload,
  Tag,
} from '../../chat/type/call.details.type';

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

export type TranscribeAudioResponse = boolean;

export interface ScenarioEvaluationMessageTag {
  id: string;
  tags: Array<{ label: string; category: string }>;
}

export interface ScenarioEvaluationSkillCoverageItem {
  category: 'Learning' | 'Support' | 'Standards';
  percentage: number;
}

export interface ScenarioEvaluationEmotionalMovementItem {
  message_id: string;
  level: number;
  start_time?: number;
}

export interface ScenarioEvaluationResponse {
  improvements: string[];
  positives: string[];
  session_glimpse: string | null;
  cumulative_memory: string | null;
  message_tags: ScenarioEvaluationMessageTag[];
  skill_coverage?: ScenarioEvaluationSkillCoverageItem[];
  emotional_movement: ScenarioEvaluationEmotionalMovementItem[];
}
