import { RagQualityAnalyticsService } from '../rag-quality-analytics.service';

/**
 * The service's job is to keep a small sample from reading as a finding, and to keep the
 * judged population pinned to one rubric. Both are judgement calls a typecheck cannot hold.
 */
describe('RagQualityAnalyticsService', () => {
  const build = (over: Record<string, unknown> = {}) => {
    const repository = {
      coverage: jest.fn().mockResolvedValue({
        retrievals: 40,
        judged: 30,
        passages: 120,
        judged_passages: 96,
      }),
      sufficiency: jest
        .fn()
        .mockResolvedValue([{ label: 'sufficient', count: 20 }]),
      relevance: jest.fn().mockResolvedValue({
        labels: [
          { label: 'relevant', count: 60 },
          { label: 'tangential', count: 24 },
        ],
        superficial: 7,
      }),
      byConsumer: jest.fn().mockResolvedValue([
        {
          consumer: 'interview_agent',
          retrievals: 25,
          judged: 20,
          empty_retrievals: 3,
        },
      ]),
      floorCurve: jest.fn().mockResolvedValue([
        {
          floor: 0.45,
          kept: 40,
          relevant: 30,
          tangential: 6,
          irrelevant: 4,
          relevant_lost: 11,
        },
      ]),
      gaps: jest.fn().mockResolvedValue([
        {
          query: 'how specific should a character be?',
          sufficiency: 'nothing_useful',
          missing: 'a worked example',
          consumer: 'interview_agent',
          returned_count: 0,
          min_similarity: 0.35,
          occurred_at: new Date('2026-09-10T15:41:00Z'),
        },
      ]),
      judgeVersions: jest.fn().mockResolvedValue([
        {
          judge_model: 'gemini-2.5-pro',
          judge_prompt_version: 'v1',
          judgments: 30,
        },
      ]),
      ...over,
    };
    return {
      service: new RagQualityAnalyticsService(repository as never),
      repository,
    };
  };

  it('scopes every read to the pinned judge model and rubric version', async () => {
    const { service, repository } = build();
    await service.getRagQuality({});
    for (const spy of [
      repository.sufficiency,
      repository.relevance,
      repository.floorCurve,
      repository.gaps,
    ]) {
      const [filter] = spy.mock.calls[0];
      expect(filter.judgeModel).toBe('gemini-2.5-pro');
      expect(filter.judgePromptVersion).toBe('v1');
    }
  });

  it('flags a sample too small to carry a percentage', async () => {
    // "7 of 10" and "70%" are not the same claim, and a corpus can legitimately see a
    // handful of retrievals a day.
    const { service } = build({
      coverage: jest.fn().mockResolvedValue({
        retrievals: 9,
        judged: 6,
        passages: 20,
        judged_passages: 14,
      }),
    });
    const res = await service.getRagQuality({});
    expect(res.coverage.judged).toBe(6);
    expect(res.coverage.belowReportingFloor).toBe(true);
  });

  it('does not flag a sample that supports one', async () => {
    const { service } = build();
    const res = await service.getRagQuality({});
    expect(res.coverage.belowReportingFloor).toBe(false);
  });

  it('asks for the floors that were actually argued over, plus looser ones', async () => {
    // 0.5 by reasoning, 0.45 after a direct hit measured 0.5056, 0.35 after a query returned
    // nothing against a document that answered it. The curve is what settles the next move.
    const { service, repository } = build();
    await service.getRagQuality({});
    const [, floors] = repository.floorCurve.mock.calls[0];
    expect(floors).toEqual(expect.arrayContaining([0.35, 0.45, 0.5]));
  });

  it('returns counts, never a computed percentage', async () => {
    const { service } = build();
    const res = await service.getRagQuality({});
    const serialised = JSON.stringify(res);
    expect(res.sufficiency[0]).toEqual({ label: 'sufficient', count: 20 });
    expect(res.superficialMatches).toBe(7);
    // No rate fields at all: the client computes them only when coverage allows.
    expect(serialised).not.toMatch(/"[a-zA-Z]*[Rr]ate"/);
    expect(serialised).not.toMatch(/"percent/);
  });

  it('carries what a higher floor would have discarded', async () => {
    const { service } = build();
    const res = await service.getRagQuality({});
    expect(res.floorCurve[0].relevantLost).toBe(11);
  });

  it('passes the consumer and corpus narrowing through', async () => {
    const { service, repository } = build();
    await service.getRagQuality({
      consumer: 'interview_agent',
      corpus: 'character_library',
    });
    const [filter] = repository.coverage.mock.calls[0];
    expect(filter.consumer).toBe('interview_agent');
    expect(filter.corpus).toBe('character_library');
  });

  it('reports the gap text, which is the only thing that names a corpus hole', async () => {
    const { service } = build();
    const res = await service.getRagQuality({});
    expect(res.gaps[0].missing).toBe('a worked example');
    expect(res.gaps[0].returnedCount).toBe(0);
    expect(res.gaps[0].occurredAt).toBe('2026-09-10T15:41:00.000Z');
  });

  it('surfaces more than one judge version rather than silently mixing them', async () => {
    const { service } = build({
      judgeVersions: jest.fn().mockResolvedValue([
        {
          judge_model: 'gemini-2.5-pro',
          judge_prompt_version: 'v1',
          judgments: 30,
        },
        {
          judge_model: 'gemini-2.5-pro',
          judge_prompt_version: 'v2',
          judgments: 4,
        },
      ]),
    });
    const res = await service.getRagQuality({});
    expect(res.judgeVersions).toHaveLength(2);
  });
});
