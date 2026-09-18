import axios from 'axios';
import { RagQualityJudgeService } from '../rag-quality-judge.service';

jest.mock('axios');

/**
 * The judgements here are the ones a typecheck cannot see, and each one is a way this judge
 * could report a confident number about the wrong thing:
 *
 *   - it must judge a retrieval that returned NOTHING, because that row carries the only
 *     signal separating a corpus gap from a floor set too tight;
 *   - it must NOT judge a retrieval whose passages outlived their chunk text;
 *   - a failed call must never be stored as "nothing useful", which would blame the corpus
 *     for our own outage in the column the corpus is read by; and
 *   - a batch must not be one consumer's afternoon of threshold-probing.
 */
describe('RagQualityJudgeService', () => {
  const post = axios.post as jest.Mock;

  const retrieval = (over: Record<string, unknown> = {}) => ({
    id: 'ret-1',
    corpus: 'character_library',
    consumer: 'interview_agent',
    query: 'how specific should a character be?',
    min_similarity: 0.35,
    returned_count: 1,
    occurred_at: new Date('2026-09-09T10:00:00Z'),
    ...over,
  });

  const build = (
    opts: {
      rows?: Array<Record<string, unknown>>;
      passages?: { passages: unknown[]; recorded: number };
      response?: unknown;
    } = {},
  ) => {
    const repo = {
      fetchRubric: jest.fn().mockResolvedValue(null),
      selectRetrievals: jest.fn().mockResolvedValue(opts.rows ?? [retrieval()]),
      buildPassages: jest.fn().mockResolvedValue(
        opts.passages ?? {
          passages: [
            {
              passage_id: 'p1',
              chunk_id: 'c1',
              document_id: 'd1',
              document_title: 'Designing Clients',
              section_path: 'Specific beats representative',
              similarity: 0.51,
              outcome: 'returned',
              pass: 'preferred',
              text: 'A generic option is not a person.',
            },
          ],
          recorded: 1,
        },
      ),
      upsertJudgments: jest.fn().mockResolvedValue(1),
    };
    const store = new Map<string, string>();
    const redis = {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
    };
    post.mockReset();
    post.mockResolvedValue({
      data: opts.response ?? {
        judge_model: 'gemini-2.5-pro',
        judge_prompt_version: 'v1',
        passages: [
          { chunk_id: 'c1', relevance: 'relevant', superficial_match: false },
        ],
        retrieval: { sufficiency: 'sufficient', missing: null },
      },
    });
    const service = new RagQualityJudgeService(
      repo as never,
      {
        ai: { apiUrl: 'http://ai.test', outboundApiKey: 'k' },
      } as never,
      redis as never,
    );
    return { service, repo, redis };
  };

  /** Runs a backfill and waits for the detached job loop to settle. */
  const run = async (service: RagQualityJudgeService, limit?: number) => {
    const started = await service.startBackfill(30, null, 1, limit ?? null);
    for (let i = 0; i < 50; i += 1) {
      const job = await service.getJob(started.jobId);
      if (job && (job.status === 'done' || job.status === 'error')) return job;
      await new Promise((r) => setImmediate(r));
    }
    throw new Error('job did not settle');
  };

  it('judges a retrieval that returned nothing', async () => {
    // The most informative row in the log. Skipping it would leave the corpus-gap question
    // permanently unanswerable, because the counts alone cannot tell it from a tight floor.
    const { service, repo } = build({
      rows: [retrieval({ returned_count: 0 })],
      passages: { passages: [], recorded: 0 },
      response: {
        judge_model: 'gemini-2.5-pro',
        judge_prompt_version: 'v1',
        passages: [],
        retrieval: {
          sufficiency: 'nothing_useful',
          missing: 'how specific to make an option',
        },
      },
    });
    const job = await run(service);

    expect(post).toHaveBeenCalledTimes(1);
    expect(job.judged).toBe(1);
    expect(job.retrievalsUnhelpful).toBe(1);
    expect(repo.upsertJudgments).toHaveBeenCalled();
  });

  it('skips a retrieval whose passages outlived their chunk text', async () => {
    // A re-chunk deleted the generation this retrieval read from. Judging the remainder
    // would label it as a retrieval that found less than it actually did.
    const { service, repo } = build({
      passages: { passages: [], recorded: 4 },
    });
    const job = await run(service);

    expect(post).not.toHaveBeenCalled();
    expect(job.skipped).toBe(1);
    expect(job.judged).toBe(0);
    expect(repo.upsertJudgments).not.toHaveBeenCalled();
  });

  it('counts a verdictless response as failed, not as "nothing useful"', async () => {
    const { service, repo } = build({
      response: {
        judge_model: 'gemini-2.5-pro',
        judge_prompt_version: 'v1',
        passages: [],
        retrieval: null,
      },
    });
    const job = await run(service);

    expect(job.failed).toBe(1);
    expect(job.judged).toBe(0);
    expect(repo.upsertJudgments).not.toHaveBeenCalled();
  });

  it('keeps going when one retrieval throws', async () => {
    const { service } = build({
      rows: [retrieval({ id: 'ret-1' }), retrieval({ id: 'ret-2' })],
    });
    post.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({
      data: {
        judge_model: 'gemini-2.5-pro',
        judge_prompt_version: 'v1',
        passages: [{ chunk_id: 'c1', relevance: 'relevant' }],
        retrieval: { sufficiency: 'sufficient' },
      },
    });
    const job = await run(service);

    expect(job.status).toBe('done');
    expect(job.failed).toBe(1);
    expect(job.judged).toBe(1);
  });

  it('samples across both consumers instead of taking the newest rows', async () => {
    // An operator probing thresholds in the admin preview can generate hundreds of
    // retrievals in an afternoon. Newest-first, that afternoon becomes the measurement, and
    // the number describes the operator rather than the corpus.
    const { service, repo } = build();
    await run(service, 120);

    const consumers = repo.selectRetrievals.mock.calls.map(
      ([opts]: [{ consumer?: string; limit?: number }]) => opts.consumer,
    );
    expect(consumers).toEqual(
      expect.arrayContaining(['interview_agent', 'admin_preview']),
    );
    const [firstOpts] = repo.selectRetrievals.mock.calls[0];
    expect(firstOpts.limit).toBe(60);
  });

  it('sends the query, corpus and the floor that actually ran', async () => {
    // The floor is what these labels calibrate; sending the current default instead would
    // describe a retrieval that never happened.
    const { service } = build({
      rows: [retrieval({ min_similarity: 0.45 })],
    });
    await run(service);

    const [url, body, config] = post.mock.calls[0];
    expect(url).toBe('http://ai.test/api/v1/rag-quality/judge');
    expect(body.query).toBe('how specific should a character be?');
    expect(body.corpus).toBe('character_library');
    expect(body.min_similarity).toBe(0.45);
    expect(body.passages[0].chunk_id).toBe('c1');
    expect(body.passages[0].text).toBe('A generic option is not a person.');
    expect(config.headers['x-api-key']).toBe('k');
  });

  it('persists the model ally-ai says ran, not the one configured', async () => {
    // A fallback stored under the configured name mixes two judges into one pinned series.
    const { service, repo } = build({
      response: {
        judge_model: 'gemini-2.5-flash',
        judge_prompt_version: 'v1',
        passages: [{ chunk_id: 'c1', relevance: 'tangential' }],
        retrieval: { sufficiency: 'partial', missing: 'a worked example' },
      },
    });
    await run(service);

    const call = repo.upsertJudgments.mock.calls[0];
    expect(call[4]).toBe('gemini-2.5-flash');
    expect(call[5]).toBe('v1');
  });

  it('counts tangential and irrelevant passages as unhelpful', async () => {
    // Tangential is not a softer relevant: material on the right subject that does not
    // answer the question asked is a chunking problem, and folding it into "relevant" is how
    // that stays invisible.
    const { service } = build({
      response: {
        judge_model: 'gemini-2.5-pro',
        judge_prompt_version: 'v1',
        passages: [
          { chunk_id: 'c1', relevance: 'tangential' },
          { chunk_id: 'c2', relevance: 'irrelevant', superficial_match: true },
          { chunk_id: 'c3', relevance: 'relevant' },
        ],
        retrieval: { sufficiency: 'partial' },
      },
    });
    const job = await run(service);
    expect(job.passagesUnhelpful).toBe(2);
  });

  it('asks only for retrievals unjudged under the target version', async () => {
    const { service, repo } = build();
    await service.startBackfill(
      30,
      { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v1' },
      1,
      null,
    );
    await new Promise((r) => setImmediate(r));
    const [opts] = repo.selectRetrievals.mock.calls[0];
    expect(opts.unjudgedForVersion).toEqual({
      judgeModel: 'gemini-2.5-pro',
      judgePromptVersion: 'v1',
    });
    expect(opts.sinceDays).toBe(30);
  });
});
