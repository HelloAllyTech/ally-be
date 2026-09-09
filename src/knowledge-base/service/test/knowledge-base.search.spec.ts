import { KbCorpus } from '../../enum/knowledge-base.enum';
import { KnowledgeBaseService } from '../knowledge-base.service';

/**
 * The two things this covers are both silent failures.
 *
 * A scope that is dropped rather than applied answers one consumer's question from another
 * consumer's material — and reads perfectly, because the retrieved prose is real prose. A boost
 * implemented as a filter hides the unmapped passage that turns out to matter, and nothing in the
 * output says a source was withheld.
 */

const passage = (over: Record<string, any> = {}) => ({
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

describe('KnowledgeBaseService.search', () => {
  let service: KnowledgeBaseService;
  let documentRepository: { retrievableIds: jest.Mock };
  let aiService: { searchKnowledgeChunks: jest.Mock };

  const build = (
    ids: { preferred: string[]; rest: string[] },
    responses: any[][],
  ) => {
    documentRepository = { retrievableIds: jest.fn().mockResolvedValue(ids) };
    aiService = { searchKnowledgeChunks: jest.fn() };
    responses.forEach((passages) =>
      aiService.searchKnowledgeChunks.mockResolvedValueOnce({ passages }),
    );
    aiService.searchKnowledgeChunks.mockResolvedValue({ passages: [] });
    service = new KnowledgeBaseService(
      documentRepository as any,
      {} as any,
      {} as any,
      aiService as any,
      {} as any,
      {} as any,
    );
  };

  it('sends the corpus scope as the query, never as an unscoped search', async () => {
    build({ preferred: [], rest: ['d1', 'd2'] }, [[passage()]]);

    await service.search({
      corpus: KbCorpus.CHARACTER_LIBRARY,
      query: 'q',
    } as any);

    expect(documentRepository.retrievableIds).toHaveBeenCalledWith({
      corpus: KbCorpus.CHARACTER_LIBRARY,
      tags: undefined,
      characterTopics: undefined,
    });
    expect(
      aiService.searchKnowledgeChunks.mock.calls[0][0].document_ids,
    ).toEqual(['d1', 'd2']);
  });

  it('returns nothing, and asks ally-ai nothing, when the corpus has no retrievable documents', async () => {
    // The dangerous alternative is an unscoped call: it would succeed and answer from
    // whatever else is indexed.
    build({ preferred: [], rest: [] }, []);

    const result = await service.search({
      corpus: KbCorpus.CHARACTER_LIBRARY,
      query: 'q',
    } as any);

    expect(result.passages).toEqual([]);
    expect(aiService.searchKnowledgeChunks).not.toHaveBeenCalled();
  });

  it('searches mapped documents first and leaves the rest alone when they fill the limit', async () => {
    const full = Array.from({ length: 4 }, (_, i) =>
      passage({
        chunk_id: `p${i}`,
        document_id: `d${i}`,
        char_start: i * 100,
        char_end: i * 100 + 50,
      }),
    );
    build({ preferred: ['d0', 'd1', 'd2', 'd3'], rest: ['dr'] }, [full]);

    const result = await service.search({
      corpus: KbCorpus.CHARACTER_LIBRARY,
      query: 'q',
      limit: 4,
      characterTopics: ['identity'],
    } as any);

    expect(aiService.searchKnowledgeChunks).toHaveBeenCalledTimes(1);
    expect(result.passages.map((p) => p.chunk_id)).toEqual([
      'p0',
      'p1',
      'p2',
      'p3',
    ]);
  });

  it('tops up from the rest of the corpus when the mapped pass is short — a boost, not a filter', async () => {
    build({ preferred: ['dp'], rest: ['dr'] }, [
      [passage({ chunk_id: 'mapped', document_id: 'dp' })],
      [passage({ chunk_id: 'unmapped', document_id: 'dr', similarity: 0.99 })],
    ]);

    const result = await service.search({
      corpus: KbCorpus.CHARACTER_LIBRARY,
      query: 'q',
      limit: 4,
      characterTopics: ['identity'],
    } as any);

    expect(aiService.searchKnowledgeChunks).toHaveBeenCalledTimes(2);
    expect(
      aiService.searchKnowledgeChunks.mock.calls[0][0].document_ids,
    ).toEqual(['dp']);
    expect(
      aiService.searchKnowledgeChunks.mock.calls[1][0].document_ids,
    ).toEqual(['dr']);
    // Mapped stays ahead even though the unmapped hit scored higher: the two passes searched
    // disjoint sets, so their ranks are not comparable.
    expect(result.passages.map((p) => p.chunk_id)).toEqual([
      'mapped',
      'unmapped',
    ]);
  });

  it('tops up when the mapped pass only LOOKS full because of near-duplicates', async () => {
    // Four hits from one document, all overlapping spans, collapse to one after shaping.
    // Judging fullness on the raw count would suppress the top-up and then return one passage.
    const overlapping = Array.from({ length: 4 }, (_, i) =>
      passage({
        chunk_id: `dup${i}`,
        document_id: 'dp',
        char_start: i * 10,
        char_end: i * 10 + 100,
      }),
    );
    build({ preferred: ['dp'], rest: ['dr'] }, [
      overlapping,
      [passage({ chunk_id: 'other', document_id: 'dr' })],
    ]);

    const result = await service.search({
      corpus: KbCorpus.CHARACTER_LIBRARY,
      query: 'q',
      limit: 4,
      characterTopics: ['identity'],
    } as any);

    expect(aiService.searchKnowledgeChunks).toHaveBeenCalledTimes(2);
    expect(result.passages.map((p) => p.chunk_id)).toEqual(['dup0', 'other']);
  });

  it("applies each corpus's own similarity floor, and lets a caller override it", async () => {
    build({ preferred: [], rest: ['d1'] }, [[]]);
    await service.search({
      corpus: KbCorpus.CHARACTER_LIBRARY,
      query: 'q',
    } as any);
    // 0.45, corrected down from 0.5 after a measured on-topic query scored 0.5056 —
    // see KB_MIN_SIMILARITY_DEFAULT.
    expect(
      aiService.searchKnowledgeChunks.mock.calls[0][0].min_similarity,
    ).toBe(0.45);

    build({ preferred: [], rest: ['d1'] }, [[]]);
    await service.search({ corpus: KbCorpus.WHATSAPP_QA, query: 'q' } as any);
    expect(
      aiService.searchKnowledgeChunks.mock.calls[0][0].min_similarity,
    ).toBe(0.35);

    build({ preferred: [], rest: ['d1'] }, [[]]);
    await service.search({
      corpus: KbCorpus.CHARACTER_LIBRARY,
      query: 'q',
      minSimilarity: 0.2,
    } as any);
    expect(
      aiService.searchKnowledgeChunks.mock.calls[0][0].min_similarity,
    ).toBe(0.2);
  });

  it('over-fetches so shaping cannot silently shrink the result below the limit', async () => {
    build({ preferred: [], rest: ['d1'] }, [[]]);
    await service.search({
      corpus: KbCorpus.CHARACTER_LIBRARY,
      query: 'q',
      limit: 8,
    } as any);
    expect(aiService.searchKnowledgeChunks.mock.calls[0][0].limit).toBe(24);
  });

  it('caps the over-fetch so a large limit cannot become an unbounded query', async () => {
    build({ preferred: [], rest: ['d1'] }, [[]]);
    await service.search({
      corpus: KbCorpus.CHARACTER_LIBRARY,
      query: 'q',
      limit: 50,
    } as any);
    expect(aiService.searchKnowledgeChunks.mock.calls[0][0].limit).toBe(50);
  });

  it('passes tags through as a document-level narrowing', async () => {
    build({ preferred: [], rest: ['d1'] }, [[]]);
    await service.search({
      corpus: KbCorpus.CHARACTER_LIBRARY,
      query: 'q',
      tags: ['dementia'],
    } as any);
    expect(documentRepository.retrievableIds).toHaveBeenCalledWith({
      corpus: KbCorpus.CHARACTER_LIBRARY,
      tags: ['dementia'],
      characterTopics: undefined,
    });
  });
});
