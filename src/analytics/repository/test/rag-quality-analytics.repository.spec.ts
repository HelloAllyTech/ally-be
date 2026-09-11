import { DataSource } from 'typeorm';
import {
  RagQualityAnalyticsRepository,
  RagWindowFilter,
} from '../rag-quality-analytics.repository';

/**
 * These tests guard the properties that decide whether a number is honest, none of which a
 * typecheck can see: that judgments are always scoped to ONE (model, rubric) pair, that the
 * floor curve reports what a higher floor would have DISCARDED and not only what it keeps,
 * and that nothing here filters by tenant — because a retrieval does not have one.
 */
describe('RagQualityAnalyticsRepository', () => {
  let query: jest.Mock;
  let repository: RagQualityAnalyticsRepository;

  const filter: RagWindowFilter = {
    from: new Date('2026-08-12T00:00:00Z'),
    toExclusive: new Date('2026-09-11T00:00:00Z'),
    consumer: null,
    corpus: null,
    judgeModel: 'gemini-2.5-pro',
    judgePromptVersion: 'v1',
  };

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    repository = new RagQualityAnalyticsRepository({
      query,
    } as unknown as DataSource);
  });

  it('pins every judgment read to one model and rubric version', async () => {
    // A rate that mixes two judges is not a rate. This is the same trap the language judge
    // documented, and the only defence is that the pair is in every WHERE clause.
    await repository.sufficiency(filter);
    await repository.relevance(filter);
    await repository.floorCurve(filter, [0.35]);
    for (const [sql, params] of query.mock.calls) {
      expect(sql).toContain('judge_model');
      expect(sql).toContain('judge_prompt_version');
      expect(params).toContain('gemini-2.5-pro');
      expect(params).toContain('v1');
    }
  });

  it('reports every judge version present, WITHOUT the pin', async () => {
    // The one query that must not filter: it exists to reveal that a window mixes two pairs.
    await repository.judgeVersions(filter);
    const [sql] = query.mock.calls[0];
    expect(sql).toContain('GROUP BY j.judge_model, j.judge_prompt_version');
    expect(sql).not.toContain('j.judge_model = $');
  });

  it('bounds the window half-open, so a bucket cannot be counted twice', async () => {
    await repository.sufficiency(filter);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('r."createdAt" >= $1');
    expect(sql).toContain('r."createdAt" < $2');
    expect(params[0]).toEqual(filter.from);
    expect(params[1]).toEqual(filter.toExclusive);
  });

  it('applies no tenant predicate anywhere', async () => {
    // Unlike every other analytics repository, and deliberately: a corpus retrieval has no
    // tenant. The population that distorts these numbers is the admin preview, which
    // `consumer` separates.
    await repository.coverage(filter);
    await repository.byConsumer(filter);
    await repository.gaps(filter, 10);
    for (const [sql] of query.mock.calls) {
      expect(sql).not.toContain('tenant');
      expect(sql).not.toContain('isTestOrganization');
    }
  });

  it('narrows to one consumer and corpus when asked', async () => {
    await repository.sufficiency({
      ...filter,
      consumer: 'interview_agent',
      corpus: 'character_library',
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('r.consumer = $3');
    expect(sql).toContain('r.corpus = $4');
    expect(params).toContain('interview_agent');
    expect(params).toContain('character_library');
  });

  it('counts what a higher floor would have thrown away', async () => {
    // `relevantLost` is the column the floor argument turns on: 0.5 was set by reasoning, and
    // a direct hit measured 0.5056. Keeping only "what survives" would hide that entirely.
    await repository.floorCurve(filter, [0.35, 0.45]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('similarity < f.floor');
    expect(sql).toContain("relevance = 'relevant'");
    expect(sql).toContain('relevant_lost');
    expect(params).toContainEqual([0.35, 0.45]);
  });

  it('computes every floor over the same population', async () => {
    // One LATERAL over a floor list rather than N near-identical queries, so two rows of the
    // curve can never be computed from different sets.
    await repository.floorCurve(filter, [0.2, 0.35]);
    const [sql] = query.mock.calls[0];
    expect(sql).toContain('WITH judged AS');
    expect(sql).toContain('unnest(');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('orders gaps by when the retrieval happened, not when it was judged', async () => {
    // A backfill catching up would otherwise push month-old rows to the top of a list that
    // reads as recent.
    await repository.gaps(filter, 15);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('ORDER BY r."createdAt" DESC');
    expect(sql).toContain("j.sufficiency <> 'sufficient'");
    expect(params).toContain(15);
  });

  it('counts empty retrievals per consumer', async () => {
    // The row that separates "the corpus lacks this" from "the floor was too tight" — but
    // only together with the judge's `missing` text, which `gaps` carries.
    await repository.byConsumer(filter);
    const [sql] = query.mock.calls[0];
    expect(sql).toContain('FILTER (WHERE r.returned_count = 0)');
  });

  it('counts passages and judged passages without dropping unjudged retrievals', async () => {
    // A LEFT JOIN LATERAL: a retrieval with no judgment still contributes to `retrievals`,
    // which is what makes coverage readable as "judged out of logged".
    await repository.coverage(filter);
    const [sql] = query.mock.calls[0];
    expect(sql).toContain('LEFT JOIN kb_retrieval_judgments');
    expect(sql).toContain('LEFT JOIN LATERAL');
  });
});
