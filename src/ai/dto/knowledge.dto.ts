/**
 * Wire shapes for ally-ai's knowledge endpoints (`/knowledge-chunks/*`, `/knowledge-agent/*`).
 *
 * Deliberately snake_case: these mirror ally-ai's pydantic schemas exactly, and translating case
 * at the boundary is how a field quietly stops being sent. The mapping to camelCase happens in the
 * knowledge-base and whatsapp services, where the entities live.
 */

// ── Chunk index ─────────────────────────────────────────────────────────────

export interface KnowledgeChunkItemRequest {
  chunk_id: string;
  document_id: string;
  document_title: string;
  chunk_index: number;
  text: string;
  char_start: number;
  char_end: number;
  page_from: number;
  page_to: number;
  section_path: string;
  source_url: string;
  language: string;
  tags: string[];
  token_count: number;
}

export interface KnowledgeChunkBulkUpsertRequest {
  items: KnowledgeChunkItemRequest[];
}

export interface KnowledgeChunkBulkUpsertResponse {
  /**
   * Per-chunk outcomes, deliberately split. `indexed_chunk_count` advances from `succeeded` and
   * only `failed` is retried — a batch reporting blanket success while dropping chunks would leave
   * a document permanently short of passages while displaying as fully indexed.
   */
  succeeded: { chunk_id: string; text_hash: string; embedding_model: string }[];
  failed: { chunk_id: string; error: string }[];
}

export interface KnowledgeChunkDeleteResponse {
  document_id: string;
  deleted: number;
}

export interface KnowledgeChunkSearchRequest {
  query: string;
  limit?: number;
  min_similarity?: number;
  document_ids?: string[];
  language?: string;
}

export interface KnowledgeChunkPassage {
  chunk_id: string;
  document_id: string;
  document_title: string;
  chunk_index: number;
  text: string;
  char_start: number;
  char_end: number;
  page_from: number;
  page_to: number;
  section_path: string;
  source_url: string;
  language: string;
  token_count: number;
  similarity: number;
}

export interface KnowledgeChunkSearchResponse {
  passages: KnowledgeChunkPassage[];
}

// ── Answering agent ─────────────────────────────────────────────────────────

export type KnowledgeAnswerIntent = 'answer' | 'decline' | 'clarify';

export type KnowledgeDeclineReason =
  | 'none'
  | 'no_hits'
  | 'below_threshold'
  | 'model_declined'
  | 'error';

export interface KnowledgeAnswerRequest {
  question: string;
  history?: { role: string; content: string }[];
  /** Prompt overrides from src/prompt, carrying the admin-selected provider/model/temperature. */
  prompts?: Record<string, unknown>;
  top_k?: number;
  min_similarity?: number;
  decline_similarity?: number;
  max_passages?: number;
  max_context_tokens?: number;
  similarity_band?: number;
  max_answer_chars?: number;
  translate_query?: boolean;
  document_ids?: string[];
}

export interface KnowledgeCitation {
  passage_number: number;
  chunk_id: string;
  document_id: string;
  document_title: string;
  page_from: number;
  page_to: number;
  section_path: string;
  source_url: string;
  similarity: number;
}

export interface KnowledgeRetrievalMeta {
  top_k: number;
  min_similarity: number;
  decline_similarity: number;
  hit_count: number;
  top_similarity: number;
  passages_used: number;
  query_language: string;
  /** The English text actually embedded, when the question was translated; null if searched as-is. */
  translated_query: string | null;
  /** True when the model answered but cited nothing. Counted, not discarded. */
  unsupported: boolean;
}

export interface KnowledgeAnswerResponse {
  intent: KnowledgeAnswerIntent;
  answer: string;
  language: string;
  confidence: number;
  citations: KnowledgeCitation[];
  decline_reason: KnowledgeDeclineReason;
  retrieval: KnowledgeRetrievalMeta;
  /** What ACTUALLY ran — dispatch falls back when a key is missing. Empty on a pre-LLM decline. */
  provider: string;
  model: string;
  prompt_version: string;
}

export interface CrisisCheckRequest {
  message: string;
  prompts?: Record<string, unknown>;
}

/**
 * The crisis classifier's verdict.
 *
 * `failed` is carried rather than folded into `is_crisis: false`, so the caller can tell "the
 * classifier looked and said no" from "the classifier could not run". The second is a degraded safety
 * net held up by the keyword rules alone, and that is worth knowing about rather than inferring.
 */
export interface CrisisCheckResponse {
  is_crisis: boolean;
  /** The phrase from the message that drove the verdict, verbatim. Empty when not a crisis. */
  signal: string;
  /**
   * How clear-cut the verdict is. NOT a threshold to gate on: the prompt instructs the model to
   * choose crisis when uncertain, so a low confidence with is_crisis=true is the intended output of
   * a borderline message, and second-guessing it here would undo that instruction.
   */
  confidence: number;
  failed: boolean;
  provider?: string;
  model?: string;
}
