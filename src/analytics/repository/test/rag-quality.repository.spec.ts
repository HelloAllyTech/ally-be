import { DataSource } from 'typeorm';
import {
  RagPassage,
  RagQualityRepository,
  RagRetrievalRow,
} from '../rag-quality.repository';

/**
 * What is worth testing here is the integrity of a rate.
 *
 * Every number this table feeds is computed in SQL over these rows, so a label stored against
 * the wrong passage, or counted twice, does not surface as an error — it surfaces as a
 * plausible precision figure that is quietly wrong, which is worse than no figure.
 */
describe('RagQualityRepository', () => {
  let query: jest.Mock;
  let transaction: jest.Mock;
  let repository: RagQualityRepository;

  const retrieval: RagRetrievalRow = {
    id: 'ret-1',
    corpus: 'character_library',
    consumer: 'interview_agent',
    query: 'how does dementia change speech?',
    min_similarity: 0.35,
    returned_count: 2,
    occurred_at: new Date('2026-09-09T10:00:00Z'),
  };

  const passage = (
    chunkId: string,
    over: Partial<RagPassage> = {},
  ): RagPassage => ({
    passage_id: `p-${chunkId}`,
    chunk_id: chunkId,
    document_id: 'doc-1',
    document_title: 'Designing Clients',
    section_path: 'How speech changes',
    similarity: 0.51,
    outcome: 'returned',
    pass: 'preferred',
    text: 'Word-finding difficulty sounds like circling.',
    ...over,
  });

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    transaction = jest.fn(
      async (fn: (m: { query: jest.Mock }) => Promise<void>) => {
        await fn({ query });
      },
    );
    repository = new RagQualityRepository({
      query,
      transaction,
    } as unknown as DataSource);
  });

  describe('selectRetrievals', () => {
    it('does NOT exclude retrievals that returned nothing', async () => {
      // Those are the most informative rows in the log: a corpus gap and a floor set too
      // tight are the same count, and only the judge's `missing` text separates them.
      await repository.selectRetrievals({ sinceDays: 30 });
      const [sql] = query.mock.calls[0];
      expect(sql).not.toContain('returned_count > 0');
      expect(sql).toContain('length(btrim(r.query)) > 0');
    });

    it('scopes "already judged" to one model and rubric version', async () => {
      // What makes an interrupted run resumable, and lets a new rubric coexist with the old.
      await repository.selectRetrievals({
        unjudgedForVersion: {
          judgeModel: 'gemini-2.5-pro',
          judgePromptVersion: 'v1',
        },
      });
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('NOT EXISTS');
      expect(sql).toContain('kb_retrieval_judgments');
      expect(sql).toContain('judge_prompt_version');
      expect(params).toEqual(['gemini-2.5-pro', 'v1']);
    });

    it('can narrow to one consumer, so a batch can be sampled across both', async () => {
      await repository.selectRetrievals({ consumer: 'interview_agent' });
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('r.consumer = $1');
      expect(params).toEqual(['interview_agent']);
    });
  });

  describe('buildPassages', () => {
    it('reports how many candidates were RECORDED, not just how many are readable', async () => {
      // The gap between the two is how the caller knows a re-chunk deleted the text this
      // retrieval read from, and that the retrieval must be skipped rather than judged on
      // what survived.
      query
        .mockResolvedValueOnce([{ n: 5 }])
        .mockResolvedValueOnce([passage('c1')]);
      const { passages, recorded } = await repository.buildPassages(
        'ret-1',
        12,
      );
      expect(recorded).toBe(5);
      expect(passages).toHaveLength(1);
    });

    it('takes candidates by rank and includes the dropped ones', async () => {
      query.mockResolvedValueOnce([{ n: 2 }]).mockResolvedValueOnce([]);
      await repository.buildPassages('ret-1', 12);
      const [sql, params] = query.mock.calls[1];
      // No outcome filter: labelling the discards is how the document cap and the
      // span-overlap rule get checked against something other than their own reasoning.
      expect(sql).not.toContain("outcome = 'returned'");
      expect(sql).toContain('ORDER BY rp.rank ASC');
      expect(params).toEqual(['ret-1', 12]);
    });

    it('joins the chunk, so a passage whose text is gone is not sent as empty', async () => {
      query.mockResolvedValueOnce([{ n: 1 }]).mockResolvedValueOnce([]);
      await repository.buildPassages('ret-1', 12);
      const [sql] = query.mock.calls[1];
      expect(sql).toContain('JOIN kb_document_chunks c ON c.id = rp.chunk_id');
      expect(sql).toContain('length(btrim(c.text)) > 0');
    });
  });

  describe('upsertJudgments', () => {
    const judged = (chunkId: string, relevance = 'relevant') => ({
      chunk_id: chunkId,
      relevance,
      superficial_match: false,
      reasoning: 'because',
    });

    it('writes the retrieval verdict and one row per matched passage', async () => {
      const labelled = await repository.upsertJudgments(
        retrieval,
        [passage('c1'), passage('c2')],
        [judged('c1'), judged('c2')],
        { sufficiency: 'sufficient' },
        'gemini-2.5-pro',
        'v1',
      );
      expect(labelled).toBe(2);
      const tables = query.mock.calls.map(([sql]) => sql as string);
      expect(tables[0]).toContain('INSERT INTO kb_retrieval_judgments');
      expect(tables[1]).toContain('INSERT INTO kb_retrieval_passage_judgments');
      expect(tables).toHaveLength(3);
    });

    it('drops a label naming a chunk this retrieval never sent', async () => {
      // A hallucinated id would otherwise be stored against a passage it does not describe.
      // ally-ai drops these too; neither layer trusts the other to have done it.
      const labelled = await repository.upsertJudgments(
        retrieval,
        [passage('c1')],
        [judged('c1'), judged('invented')],
        { sufficiency: 'partial', missing: 'a case account' },
        'gemini-2.5-pro',
        'v1',
      );
      expect(labelled).toBe(1);
    });

    it('drops a duplicate label for one chunk, keeping the first', async () => {
      // A duplicate double-counts one passage in every rate computed downstream.
      const labelled = await repository.upsertJudgments(
        retrieval,
        [passage('c1')],
        [judged('c1', 'relevant'), judged('c1', 'irrelevant')],
        { sufficiency: 'sufficient' },
        'gemini-2.5-pro',
        'v1',
      );
      expect(labelled).toBe(1);
      const passageInsert = query.mock.calls.find(([sql]) =>
        (sql as string).includes('kb_retrieval_passage_judgments'),
      );
      expect(passageInsert?.[1]).toContain('relevant');
    });

    it('records skipped passages rather than absorbing them silently', async () => {
      // A precision figure computed over a judgment that ignored half the retrieval is wrong
      // in the direction that looks fine.
      await repository.upsertJudgments(
        retrieval,
        [passage('c1'), passage('c2'), passage('c3')],
        [judged('c1')],
        { sufficiency: 'partial', missing: 'x' },
        'gemini-2.5-pro',
        'v1',
      );
      const [, params] = query.mock.calls[0];
      // passages_judged then passages_skipped.
      expect(params[3]).toBe(1);
      expect(params[4]).toBe(2);
    });

    it('stores an empty retrieval as a verdict with no passage rows', async () => {
      const labelled = await repository.upsertJudgments(
        { ...retrieval, returned_count: 0 },
        [],
        [],
        {
          sufficiency: 'nothing_useful',
          missing: 'how specific to make an option',
        },
        'gemini-2.5-pro',
        'v1',
      );
      expect(labelled).toBe(0);
      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('kb_retrieval_judgments');
      expect(params).toContain('nothing_useful');
      expect(params).toContain('how specific to make an option');
    });

    it('stores a blank `missing` as NULL', async () => {
      // The gap question is `missing IS NOT NULL`; an empty string answers "yes, a gap,
      // unnamed" to all of them. Gemini returns "" for a sufficient retrieval in practice.
      await repository.upsertJudgments(
        retrieval,
        [passage('c1')],
        [judged('c1')],
        { sufficiency: 'sufficient', missing: '   ' },
        'gemini-2.5-pro',
        'v1',
      );
      const [, params] = query.mock.calls[0];
      expect(params[2]).toBeNull();
    });

    it('carries the passage’s own similarity and outcome onto its label', async () => {
      // The whole point of the table: precision at every candidate floor is a scan over
      // (similarity, relevance) with no join, and it must segment by consumer.
      await repository.upsertJudgments(
        retrieval,
        [
          passage('c1', {
            similarity: 0.4213,
            outcome: 'dropped_document_cap',
          }),
        ],
        [judged('c1', 'irrelevant')],
        { sufficiency: 'partial' },
        'gemini-2.5-pro',
        'v1',
      );
      const [, params] = query.mock.calls[1];
      expect(params).toContain(0.4213);
      expect(params).toContain('dropped_document_cap');
      expect(params).toContain('interview_agent');
    });

    it('writes both units in ONE transaction', async () => {
      // A retrieval must never carry passage labels without the sufficiency row that says
      // what they add up to.
      await repository.upsertJudgments(
        retrieval,
        [passage('c1')],
        [judged('c1')],
        { sufficiency: 'sufficient' },
        'gemini-2.5-pro',
        'v1',
      );
      expect(transaction).toHaveBeenCalledTimes(1);
    });
  });
});
