/** S3 key prefix (folder) under the assets bucket for uploaded corpus documents. */
export const KB_DOCUMENT_S3_PREFIX = 'knowledge-base';

/**
 * Max upload size for a corpus document (50 MB).
 *
 * Generous because clinical guidelines genuinely are large scanned PDFs, and safe because the
 * file never passes through an HTTP body — the browser PUTs it straight to S3 with a
 * presigned URL. A multipart POST of this size would hit the global `express.json` 1 MB limit
 * long before it reached us.
 */
export const KB_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Chunking, in tokens.
 *
 * 400 is driven by the OUTPUT constraint, not the embedding model's 8191-token input ceiling.
 * A WhatsApp reply is composed to 1600 characters, which can only honestly ground on three to
 * five passages; 400 tokens is roughly two or three paragraphs, enough to carry one complete
 * clinical idea (a definition plus its qualification) without carrying three. Larger chunks
 * measurably lose retrieval precision — a 2000-token chunk covers so many topics it matches
 * everything weakly — and five 400-token passages is only ~2000 tokens of context, which is
 * cheap per question.
 *
 * The min/max band exists so the splitter can respect sentence and section boundaries instead
 * of cutting at exactly 400 and slicing a sentence in half.
 */
export const KB_CHUNK_TARGET_TOKENS = 400;
export const KB_CHUNK_MIN_TOKENS = 320;
export const KB_CHUNK_MAX_TOKENS = 520;

/**
 * Overlap between adjacent chunks (~15% of target).
 *
 * Below roughly 10% a definition that straddles a boundary is lost from both neighbours;
 * above roughly 25% you are paying to embed and store the same words repeatedly for
 * diminishing recall.
 */
export const KB_CHUNK_OVERLAP_TOKENS = 60;

/**
 * Hard ingest caps. Each one fails the document with an explicit message naming the actual
 * number and the limit — never a silent truncation, which would leave an admin believing a
 * 400-page guideline is fully searchable when only its first third is.
 */
export const KB_MAX_CHUNKS_PER_DOCUMENT = 3000;
export const KB_MAX_EXTRACTED_CHARS = 1_500_000;

/**
 * Chunks per bulk-upsert call to ally-ai.
 *
 * Matches the embedding batch size on that side, so one call maps to one embeddings request.
 * A 300-page PDF is ~500 chunks, i.e. about eight calls — small enough that a transient
 * failure costs one batch rather than the document.
 */
export const KB_INDEX_BATCH_SIZE = 64;

/** Max characters of pasted text accepted in a single document. */
export const KB_MAX_PASTE_CHARS = 200_000;

/** Timeout for fetching a URL to ingest. */
export const KB_URL_FETCH_TIMEOUT_MS = 20_000;

/** Max bytes accepted from a URL fetch, so a huge page cannot exhaust memory. */
export const KB_URL_MAX_BYTES = 10 * 1024 * 1024;
