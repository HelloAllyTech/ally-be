/**
 * Where a corpus document came from. Immutable after creation: a PDF is not a URL, so
 * changing the source means replacing the document, not editing this field.
 */
export enum KbDocumentSourceType {
  PASTE = 'paste',
  PDF = 'pdf',
  DOCX = 'docx',
  EPUB = 'epub',
  URL = 'url',
}

/**
 * Ingest lifecycle for one document.
 *
 * Deliberately finer-grained than `reference_documents.uploadStatus`
 * (pending|success|failed), because extraction can fail completely independently of
 * indexing and an admin needs to tell those apart: "this PDF is encrypted" and "Weaviate
 * was down" have different fixes, and a single FAILED state hides which one happened.
 */
export enum KbDocumentStatus {
  PENDING = 'pending',
  EXTRACTING = 'extracting',
  CHUNKING = 'chunking',
  INDEXING = 'indexing',
  INDEXED = 'indexed',
  FAILED = 'failed',
}

/**
 * Per-chunk index state.
 *
 * Same vocabulary as `DocumentUploadStatus` in the reference-document module on purpose —
 * this is the identical "pushed to the derived vector index or not" question, and two
 * different spellings of it would invite two different handlings.
 *
 * Per CHUNK rather than only per document because ally-ai's bulk-upsert reports partial
 * success: a document can be 384 of 500 chunks indexed, and resuming has to retry exactly
 * the 116 that failed.
 */
export enum KbChunkUploadStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
}
