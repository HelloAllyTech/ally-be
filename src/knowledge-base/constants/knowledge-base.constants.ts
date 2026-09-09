import { KbCorpus } from '../enum/knowledge-base.enum';

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
 * Chunk sizing, per corpus.
 *
 * The SPLITTER is one general-purpose mechanism and stays that way — section, paragraph and
 * sentence boundaries, then a hard cut, are right for any prose. What legitimately differs is
 * how big a chunk should be, because that is set by what the consuming answer needs to be, not
 * by the document.
 *
 * `whatsapp_qa` — 400 tokens, derived above from a 1600-character reply grounding on three to
 * five passages. One complete clinical idea: a definition plus its qualification.
 *
 * `character_library` — 800, because the unit of use is different. The interview agent is not
 * answering a question; it is drafting a person, and what makes a draft real is a whole
 * observation held together: a case vignette, a description of how someone at this stage of
 * dementia actually talks, a caregiver's day. Those run 500–900 tokens, and a 400-token cut
 * lands in the middle of one — leaving the situation without the speech, or the symptom without
 * the family. Retrieving both halves is not the same as retrieving the whole, because they
 * compete for the same top-k slots and the model has to guess that they join.
 *
 * The larger overlap (120, holding ~15%) follows the target for the same reason it exists at
 * 400: below roughly 10% a thought that straddles a boundary is lost from both neighbours.
 *
 * Sizing is fixed at INGEST, so changing a profile only affects documents chunked afterwards.
 * Re-chunking an existing one is the `chunkVersion` path — it writes new chunk rows and deletes
 * the old generation's vectors, so a profile change is applied by re-indexing, never in place.
 */
export interface KbChunkProfile {
  targetTokens: number;
  minTokens: number;
  maxTokens: number;
  overlapTokens: number;
}

export const KB_CHUNK_PROFILES: Record<KbCorpus, KbChunkProfile> = {
  [KbCorpus.WHATSAPP_QA]: {
    targetTokens: KB_CHUNK_TARGET_TOKENS,
    minTokens: KB_CHUNK_MIN_TOKENS,
    maxTokens: KB_CHUNK_MAX_TOKENS,
    overlapTokens: KB_CHUNK_OVERLAP_TOKENS,
  },
  [KbCorpus.CHARACTER_LIBRARY]: {
    targetTokens: 800,
    minTokens: 640,
    maxTokens: 1040,
    overlapTokens: 120,
  },
};

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

/**
 * Default cosine similarity floor per corpus, and the reason they differ.
 *
 * The WhatsApp bot answers a question it was asked. A weak passage there is recoverable: the
 * answering prompt can see it doesn't address the question and decline, and declining is a
 * first-class outcome on that path (`KnowledgeDeclineReason`). Recall is worth more than
 * precision, so 0.35 stands.
 *
 * The character interview has no such backstop. Nobody asked a question; the agent is drafting
 * a person, and a loosely-related passage does not get declined — it gets absorbed. A book about
 * adolescent anxiety retrieved at 0.38 while interviewing about an 80-year-old with dementia
 * will still contribute plausible-sounding detail, and the failure is invisible: the draft reads
 * *better* for being more specific, and only a clinician notices the specifics belong to someone
 * else. Grounding that can't be declined has to be grounding that was actually close, so the
 * floor is higher and retrieving nothing is an acceptable answer.
 *
 * 0.45 rather than the 0.5 first chosen, and the correction came from a measurement rather than
 * a second opinion. An unambiguously on-topic local query ("why does someone with dementia keep
 * asking the same question?" against a passage explicitly about exactly that) scored 0.5056 with
 * text-embedding-3-small. A floor of 0.5 would have admitted it by six thousandths — which means
 * the floor was not selecting for "actually close", it was one paraphrase away from rejecting a
 * direct hit. 0.45 keeps a real margin over the Q&A corpus's 0.35 without sitting on top of the
 * scores relevant material actually produces.
 *
 * Still a starting point, not a tuned value: it is calibrated against one measurement on one
 * passage, and the character corpus has no real content yet. `KbSearchDto.minSimilarity`
 * overrides it per request and the retrieval preview shows the scores, so this is meant to be
 * revisited against real material rather than trusted.
 */
export const KB_MIN_SIMILARITY_DEFAULT: Record<KbCorpus, number> = {
  [KbCorpus.WHATSAPP_QA]: 0.35,
  [KbCorpus.CHARACTER_LIBRARY]: 0.45,
};

/**
 * Max passages one document may contribute to a single retrieval.
 *
 * Three, not one: a chapter genuinely does carry a definition, its qualification and an
 * illustrative case, and forcing breadth to one passage per document would drop two thirds of
 * the only source that covers the topic. Three is also comfortably under a typical limit of 8,
 * so a corpus with three or more relevant documents still returns three or more voices.
 */
export const KB_MAX_PASSAGES_PER_DOCUMENT = 3;
