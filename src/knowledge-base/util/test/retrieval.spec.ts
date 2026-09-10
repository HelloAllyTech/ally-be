import { KnowledgeChunkPassage } from 'src/ai/dto/knowledge.dto';
import { concatDistinct, shapePassages } from '../retrieval';

/**
 * Shaping is invisible when it works and invisible when it doesn't: the caller gets a plausible
 * list of passages either way. What it prevents is a top-k that spends most of its budget
 * re-reading one page — which reads as a confident, well-grounded answer built on one source.
 */

const passage = (
  over: Partial<KnowledgeChunkPassage> = {},
): KnowledgeChunkPassage => ({
  chunk_id: 'c1',
  document_id: 'd1',
  document_title: 'Doc',
  chunk_index: 0,
  text: 'text',
  char_start: 0,
  char_end: 100,
  page_from: 1,
  page_to: 1,
  section_path: '',
  source_url: '',
  language: 'en',
  token_count: 20,
  similarity: 0.9,
  ...over,
});

const opts = { limit: 8, perDocumentLimit: 3 };

describe('shapePassages', () => {
  it('keeps a clean ranking untouched', () => {
    const input = [
      passage({
        chunk_id: 'a',
        document_id: 'd1',
        char_start: 0,
        char_end: 100,
      }),
      passage({
        chunk_id: 'b',
        document_id: 'd2',
        char_start: 0,
        char_end: 100,
      }),
    ];
    expect(shapePassages(input, opts).map((p) => p.chunk_id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('drops a span-overlapping neighbour and keeps the higher-ranked one', () => {
    // The chunker's own overlap guarantees adjacent chunks share text, so the pair scores
    // alike and both land in the top-k. Rank order decides which survives.
    const input = [
      passage({ chunk_id: 'a', char_start: 0, char_end: 100, similarity: 0.9 }),
      passage({
        chunk_id: 'b',
        char_start: 80,
        char_end: 180,
        similarity: 0.88,
      }),
      passage({
        chunk_id: 'c',
        char_start: 200,
        char_end: 300,
        similarity: 0.7,
      }),
    ];
    expect(shapePassages(input, opts).map((p) => p.chunk_id)).toEqual([
      'a',
      'c',
    ]);
  });

  it('treats touching spans as adjacent, not overlapping', () => {
    // A document chunked with no overlap produces exactly this. Dropping the neighbour would
    // discard a passage sharing no text at all.
    const input = [
      passage({ chunk_id: 'a', char_start: 0, char_end: 100 }),
      passage({ chunk_id: 'b', char_start: 100, char_end: 200 }),
    ];
    expect(shapePassages(input, opts).map((p) => p.chunk_id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('does not confuse identical spans in different documents', () => {
    const input = [
      passage({
        chunk_id: 'a',
        document_id: 'd1',
        char_start: 0,
        char_end: 100,
      }),
      passage({
        chunk_id: 'b',
        document_id: 'd2',
        char_start: 0,
        char_end: 100,
      }),
    ];
    expect(shapePassages(input, opts)).toHaveLength(2);
  });

  it('caps one document and lets a lower-ranked document through', () => {
    const input = [
      passage({
        chunk_id: 'a',
        document_id: 'd1',
        char_start: 0,
        char_end: 10,
      }),
      passage({
        chunk_id: 'b',
        document_id: 'd1',
        char_start: 20,
        char_end: 30,
      }),
      passage({
        chunk_id: 'c',
        document_id: 'd1',
        char_start: 40,
        char_end: 50,
      }),
      passage({
        chunk_id: 'd',
        document_id: 'd1',
        char_start: 60,
        char_end: 70,
      }),
      passage({
        chunk_id: 'e',
        document_id: 'd2',
        char_start: 0,
        char_end: 10,
      }),
    ];
    expect(shapePassages(input, opts).map((p) => p.chunk_id)).toEqual([
      'a',
      'b',
      'c',
      'e',
    ]);
  });

  it('honours the limit', () => {
    const input = Array.from({ length: 10 }, (_, i) =>
      passage({
        chunk_id: `c${i}`,
        document_id: `d${i}`,
        char_start: i * 100,
        char_end: i * 100 + 50,
      }),
    );
    expect(
      shapePassages(input, { limit: 3, perDocumentLimit: 3 }),
    ).toHaveLength(3);
  });

  it('returns nothing for nothing', () => {
    expect(shapePassages([], opts)).toEqual([]);
  });
});

describe('concatDistinct', () => {
  it('keeps the first pass ahead of the top-up', () => {
    // The two passes search disjoint document sets, so their similarities are comparable but
    // their ranks are not. Interleaving by score would undo the boost the split exists for.
    const first = [passage({ chunk_id: 'a', similarity: 0.6 })];
    const second = [passage({ chunk_id: 'b', similarity: 0.95 })];
    expect(concatDistinct(first, second).map((p) => p.chunk_id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('drops a chunk both passes returned', () => {
    const first = [passage({ chunk_id: 'a' })];
    const second = [passage({ chunk_id: 'a' }), passage({ chunk_id: 'b' })];
    expect(concatDistinct(first, second).map((p) => p.chunk_id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('handles either side being empty', () => {
    const one = [passage({ chunk_id: 'a' })];
    expect(concatDistinct(one, [])).toHaveLength(1);
    expect(concatDistinct([], one)).toHaveLength(1);
  });
});
