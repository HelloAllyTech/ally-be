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
  let retrievalRepository: { record: jest.Mock };

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
    retrievalRepository = { record: jest.fn().mockResolvedValue('r1') };
    service = new KnowledgeBaseService(
      documentRepository as any,
      {} as any,
      // documentTenantRepository — the organisation assignment, unused on this path: the
      // audience travels as a filter on the query, not as a per-row lookup.
      {} as any,
      {} as any,
      aiService as any,
      {} as any,
      {} as any,
      retrievalRepository as any,
      // tenantRepository, for the existence check on a write path this spec never takes.
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

  it('carries WHO is asking alongside WHICH documents are in scope', async () => {
    // Two different scopes on one query. The corpus decides which documents exist; the
    // audience decides whether this organisation may be answered from them. ally-ai refuses
    // a request carrying neither, so the omission cannot be silent.
    build({ preferred: [], rest: ['d1'] }, [[passage()]]);

    await service.search({
      corpus: KbCorpus.WHATSAPP_QA,
      query: 'q',
      tenantId: 'tenant-a',
    } as any);

    expect(aiService.searchKnowledgeChunks.mock.calls[0][0].audience).toEqual({
      tenant_id: 'tenant-a',
      include_global: true,
    });
  });

  it('ignores targeting when no organisation is named', async () => {
    // The admin console's job is to show what is INDEXED, which is deliberately not what a
    // worker receives — and the result echoes which of the two ran.
    build({ preferred: [], rest: ['d1'] }, [[passage()]]);

    await service.search({ corpus: KbCorpus.WHATSAPP_QA, query: 'q' } as any);

    expect(aiService.searchKnowledgeChunks.mock.calls[0][0].audience).toEqual({
      unrestricted: true,
    });
  });

  it('keeps the audience on the top-up pass', async () => {
    // A second pass that dropped it would answer out of another organisation's material
    // precisely when the first pass came back short.
    build({ preferred: ['d1'], rest: ['d2'] }, [[passage()], [passage()]]);

    await service.search({
      corpus: KbCorpus.WHATSAPP_QA,
      query: 'q',
      tenantId: 'tenant-a',
    } as any);

    expect(aiService.searchKnowledgeChunks.mock.calls.length).toBeGreaterThan(
      1,
    );
    for (const call of aiService.searchKnowledgeChunks.mock.calls) {
      expect(call[0].audience).toEqual({
        tenant_id: 'tenant-a',
        include_global: true,
      });
    }
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

/**
 * The retrieval log's job is to make retrieval's numbers answerable from data — the floor
 * above all, which was set by reasoning and turned out to be one paraphrase from rejecting a
 * direct hit. These assert the two things that would quietly destroy that: recording only the
 * survivors (so the drops that explain a thin result are invisible), and letting a logging
 * failure reach the caller (so analytics can break a working search).
 */
describe('KnowledgeBaseService.search — retrieval log', () => {
  let service: KnowledgeBaseService;
  let documentRepository: { retrievableIds: jest.Mock };
  let aiService: { searchKnowledgeChunks: jest.Mock };
  let retrievalRepository: { record: jest.Mock };

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
    retrievalRepository = { record: jest.fn().mockResolvedValue('r1') };
    service = new KnowledgeBaseService(
      documentRepository as any,
      {} as any,
      // documentTenantRepository — the organisation assignment, unused on this path: the
      // audience travels as a filter on the query, not as a per-row lookup.
      {} as any,
      {} as any,
      aiService as any,
      {} as any,
      {} as any,
      retrievalRepository as any,
      // tenantRepository, for the existence check on a write path this spec never takes.
      {} as any,
    );
  };

  const recorded = () => retrievalRepository.record.mock.calls[0];

  it('records the floor that was actually used, not the current default', async () => {
    // A row storing "the default" would be worthless the first time the default moved —
    // which is the entire reason this table exists.
    build({ preferred: [], rest: ['d1'] }, [[]]);
    await service.search({
      corpus: KbCorpus.CHARACTER_LIBRARY,
      query: 'q',
      minSimilarity: 0.31,
    } as any);
    expect(recorded()[0].minSimilarity).toBe(0.31);
  });

  it('records dropped candidates with the reason, not just the survivors', async () => {
    const overlapping = [
      passage({
        chunk_id: 'a',
        document_id: 'd1',
        char_start: 0,
        char_end: 100,
      }),
      passage({
        chunk_id: 'b',
        document_id: 'd1',
        char_start: 80,
        char_end: 180,
      }),
      passage({
        chunk_id: 'c',
        document_id: 'd1',
        char_start: 200,
        char_end: 300,
      }),
      passage({
        chunk_id: 'd',
        document_id: 'd1',
        char_start: 400,
        char_end: 500,
      }),
      passage({
        chunk_id: 'e',
        document_id: 'd1',
        char_start: 600,
        char_end: 700,
      }),
    ];
    build({ preferred: [], rest: ['d1'] }, [overlapping]);

    const result = await service.search({
      corpus: KbCorpus.CHARACTER_LIBRARY,
      query: 'q',
      limit: 8,
    } as any);

    // Three returned (the per-document cap), one dropped for overlap, one for the cap.
    expect(result.passages.map((p) => p.chunk_id)).toEqual(['a', 'c', 'd']);
    expect(recorded()[1].map((p: any) => [p.chunkId, p.outcome])).toEqual([
      ['a', 'returned'],
      ['b', 'dropped_span_overlap'],
      ['c', 'returned'],
      ['d', 'returned'],
      ['e', 'dropped_document_cap'],
    ]);
  });

  it('distinguishes "the boost filled it" from "the corpus had nothing"', async () => {
    // null vs 0 on secondPassHits. Collapsing them would make a working boost and an empty
    // corpus look identical in every aggregate.
    const four = Array.from({ length: 4 }, (_, i) =>
      passage({
        chunk_id: `p${i}`,
        document_id: `d${i}`,
        char_start: i * 100,
        char_end: i * 100 + 50,
      }),
    );
    build({ preferred: ['d0', 'd1', 'd2', 'd3'], rest: ['dr'] }, [four]);
    await service.search({
      corpus: KbCorpus.CHARACTER_LIBRARY,
      query: 'q',
      limit: 4,
      characterTopics: ['identity'],
    } as any);
    expect(recorded()[0].secondPassHits).toBeNull();

    build({ preferred: ['dp'], rest: ['dr'] }, [[], []]);
    await service.search({
      corpus: KbCorpus.CHARACTER_LIBRARY,
      query: 'q',
      limit: 4,
      characterTopics: ['identity'],
    } as any);
    expect(recorded()[0].secondPassHits).toBe(0);
  });

  it('labels which pass each candidate came from', async () => {
    build({ preferred: ['dp'], rest: ['dr'] }, [
      [passage({ chunk_id: 'mapped', document_id: 'dp' })],
      [passage({ chunk_id: 'unmapped', document_id: 'dr' })],
    ]);
    await service.search({
      corpus: KbCorpus.CHARACTER_LIBRARY,
      query: 'q',
      limit: 4,
      characterTopics: ['identity'],
    } as any);
    expect(recorded()[1].map((p: any) => [p.chunkId, p.pass])).toEqual([
      ['mapped', 'preferred'],
      ['unmapped', 'rest'],
    ]);
  });

  it('records a retrieval that found nothing', async () => {
    // The most diagnostically valuable row there is: reading the queries that returned
    // nothing is how a corpus gap gets found. A skipped row would hide exactly those.
    build({ preferred: [], rest: ['d1'] }, [[]]);
    await service.search({
      corpus: KbCorpus.CHARACTER_LIBRARY,
      query: 'nothing covers this',
    } as any);
    expect(retrievalRepository.record).toHaveBeenCalledTimes(1);
    expect(recorded()[0].returnedCount).toBe(0);
    expect(recorded()[1]).toEqual([]);
  });

  it('defaults the consumer to the admin preview rather than the agent', async () => {
    // An unattributed retrieval must not be filed as agent traffic — that is the population
    // the floor gets calibrated against.
    build({ preferred: [], rest: ['d1'] }, [[]]);
    await service.search({
      corpus: KbCorpus.CHARACTER_LIBRARY,
      query: 'q',
    } as any);
    expect(recorded()[0].consumer).toBe('admin_preview');
  });

  it('carries the interview session and consumer through when given them', async () => {
    build({ preferred: [], rest: ['d1'] }, [[]]);
    await service.search(
      { corpus: KbCorpus.CHARACTER_LIBRARY, query: 'q' } as any,
      {
        consumer: 'interview_agent' as any,
        sessionId: 'session-1',
        userId: 42,
      },
    );
    expect(recorded()[0]).toMatchObject({
      consumer: 'interview_agent',
      sessionId: 'session-1',
      createdBy: 42,
    });
  });

  it('returns passages even when the log write fails', async () => {
    // Analytics are worth a table, not a retrieval. A locked table must not turn a working
    // search into a 500 for the admin who asked.
    build({ preferred: [], rest: ['d1'] }, [[passage({ chunk_id: 'a' })]]);
    retrievalRepository.record.mockRejectedValue(new Error('table is locked'));

    const result = await service.search({
      corpus: KbCorpus.CHARACTER_LIBRARY,
      query: 'q',
    } as any);

    expect(result.passages.map((p) => p.chunk_id)).toEqual(['a']);
  });
});
