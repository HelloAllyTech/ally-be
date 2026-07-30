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

export interface ScenarioEvaluationAreaOfImprovementItem {
  improvement: string;
  recommendation: string;
}

export interface ScenarioEvaluationResponse {
  improvements: string[];
  positives: string[];
  session_glimpse: string | null;
  cumulative_memory: string | null;
  message_tags: ScenarioEvaluationMessageTag[];
  skill_coverage?: ScenarioEvaluationSkillCoverageItem[];
  emotional_movement: ScenarioEvaluationEmotionalMovementItem[];
  areas_of_growth: ScenarioEvaluationAreaOfImprovementItem[];
}

// ── Product Roadmap semantic duplicate detection (ally-ai / Weaviate) ────────

export interface RoadmapOpportunityUpsertResponse {
  opportunity_id: string;
  /** SHA-256 of the embedded text; ally-be stores it to detect staleness. */
  text_hash: string;
  embedding_model: string;
}

export interface RoadmapOpportunityBulkUpsertResponse {
  succeeded: RoadmapOpportunityUpsertResponse[];
  /** Per-item failures. The caller must surface these — a partially-failed batch that reports
   * success is exactly how the standalone app's own backfill wrote 241 fallbacks to a file
   * labelled "Done. 241 classified." */
  failed: { opportunity_id: string; error: string }[];
}

export interface RoadmapSimilarOpportunityMatch {
  opportunity_id: string;
  product_goal: string;
  /** Cosine similarity in [0, 1]. */
  similarity: number;
}

export interface RoadmapSimilarOpportunitiesResponse {
  matches: RoadmapSimilarOpportunityMatch[];
}

export interface RoadmapOpportunityDeleteResponse {
  opportunity_id: string;
  deleted: boolean;
}

/**
 * One page of ids currently held in the `RoadmapOpportunity` Weaviate collection.
 *
 * `next_cursor` is null at the end of the collection. Cursor paging, not offset paging: offset
 * paging over a collection being written to can skip objects, and a reconciliation sweep that
 * skips an id would UNDER-report drift while looking like it passed.
 */
export interface RoadmapOpportunityIdsResponse {
  ids: string[];
  next_cursor: string | null;
}
