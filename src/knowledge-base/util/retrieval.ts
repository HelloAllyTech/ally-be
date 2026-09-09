import { KnowledgeChunkPassage } from 'src/ai/dto/knowledge.dto';

/**
 * Shape a raw similarity ranking into the passages a grounded answer should actually see.
 *
 * Vector search ranks each chunk independently, which is exactly what makes its top-k a poor
 * context window: the chunks are 400 tokens with a deliberate 60-token overlap
 * (KB_CHUNK_OVERLAP_TOKENS — overlap exists so a thought that straddles a boundary survives in
 * both neighbours), so two adjacent chunks are near-guaranteed to score alike and to repeat each
 * other's best sentences. Left alone, a top-8 routinely spends half its budget re-reading one
 * page of one document. Stacks, "When to apply memory and knowledge compression": repetitive or
 * duplicate items in a store reduce retrieval efficiency — the same is true of a result set, and
 * a result set can be de-duplicated at no indexing cost.
 *
 * Two rules, applied in rank order so the highest-similarity passage always survives:
 *  - span overlap: drop a passage whose character span overlaps one already kept from the same
 *    document. This targets the overlap the chunker put there, not merely equal text.
 *  - per-document cap: no single document may supply more than `perDocumentLimit` passages.
 *
 * The cap is a breadth guarantee, and it is the more important of the two here. A character
 * grounded entirely in one handbook is that handbook's archetype; two or three sources
 * disagreeing slightly is what a real person's details look like. It costs recall on the
 * genuine case where one source is the only source, which is the right trade for material whose
 * purpose is variety.
 */
export function shapePassages(
  passages: KnowledgeChunkPassage[],
  options: { limit: number; perDocumentLimit: number },
): KnowledgeChunkPassage[] {
  const kept: KnowledgeChunkPassage[] = [];
  const spansByDocument = new Map<string, { start: number; end: number }[]>();

  for (const passage of passages) {
    if (kept.length >= options.limit) {
      break;
    }
    const spans = spansByDocument.get(passage.document_id) ?? [];
    if (spans.length >= options.perDocumentLimit) {
      continue;
    }
    if (spans.some((span) => overlaps(span, passage))) {
      continue;
    }
    spans.push({ start: passage.char_start, end: passage.char_end });
    spansByDocument.set(passage.document_id, spans);
    kept.push(passage);
  }

  return kept;
}

/**
 * Half-open span intersection. Touching spans (`end === start`) are adjacent, not overlapping:
 * a document chunked without overlap produces exactly that, and dropping the neighbour there
 * would discard a passage sharing no text at all.
 */
function overlaps(
  span: { start: number; end: number },
  passage: KnowledgeChunkPassage,
): boolean {
  return passage.char_start < span.end && span.start < passage.char_end;
}

/**
 * Merge a top-up pass into a first pass, keeping the first pass's ordering ahead of it and
 * dropping any chunk both passes returned.
 *
 * The two passes are separate searches over disjoint document sets, so their similarity scores
 * are comparable but their ranks are not — interleaving by score would undo the boost the split
 * exists to create. Preferred material stays ahead by construction; the top-up only fills the
 * space preferred material did not.
 */
export function concatDistinct(
  first: KnowledgeChunkPassage[],
  second: KnowledgeChunkPassage[],
): KnowledgeChunkPassage[] {
  const seen = new Set(first.map((passage) => passage.chunk_id));
  return [...first, ...second.filter((p) => !seen.has(p.chunk_id))];
}
