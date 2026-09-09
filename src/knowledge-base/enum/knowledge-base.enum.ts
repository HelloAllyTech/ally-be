/**
 * Which corpus a document belongs to.
 *
 * The pipeline (extract, chunk, index, retrieve, cite) is one general-purpose mechanism;
 * this is the only thing that differs between its consumers, so it is the one thing they
 * declare. The WhatsApp Q&A bot was simply the first, which is why the module used to be
 * named after it.
 *
 * Retrieval is never "the shared corpus minus a filter": callers resolve the documents of
 * ONE corpus in Postgres and pass those ids to ally-ai's search, so the scope is the query
 * itself. A filter can be forgotten; a required argument cannot. The single `KnowledgeChunk`
 * collection stays shared, because Postgres is the system of record and the vector index is
 * derived from it.
 */
export enum KbCorpus {
  /** Grounds the WhatsApp Q&A bot's answers. */
  WHATSAPP_QA = 'whatsapp_qa',
  /**
   * Grounds the Character Library interview agent — clinical and lived-experience
   * material it draws on to make its questions specific and its drafts real, rather
   * than inventing a plausible-sounding person from nothing.
   */
  CHARACTER_LIBRARY = 'character_library',
}

/**
 * What part of a character a document helps ground.
 *
 * A curator who uploads a dementia caregiving handbook and a book on adolescent anxiety
 * knows which belongs where; similarity search only sees that both are "mental health".
 * Declaring it lets that knowledge improve ranking.
 *
 * A BOOST, never a filter. Retrieval searches the documents mapped to the asked-about
 * topic first and tops up from the rest of the corpus — so mapped material wins ties, and
 * the passage that turns out relevant in a way nobody anticipated is still reachable. That
 * matters most here: the unanticipated detail is often the one that makes a character feel
 * like a person.
 *
 * Named for the SUBJECT, not for the interviewer prompt's phase numbering. The prompt's
 * wording and ordering change without a migration — they changed twice today — so a
 * mapping keyed to "phase 4" or to question text would be stale on arrival. These five
 * subjects have survived every edit, because they are what a person is made of rather than
 * how the interview happens to be sequenced. A stale mapping here costs a little ranking
 * quality; a stale filter would silently hide sources.
 */
export enum KbCharacterTopic {
  IDENTITY = 'identity',
  LIFE_CONTEXT = 'life_context',
  INNER_LIFE = 'inner_life',
  HISTORY_AND_PRESENTING_CONCERN = 'history_and_presenting_concern',
  SPEECH_AND_LANGUAGE = 'speech_and_language',
}

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
