import axios from 'axios';
import { FeedbackGroundednessJudgeService } from '../feedback-groundedness-judge.service';

jest.mock('axios');

/**
 * ally-ai answers HTTP 200 with `claims: []` when its model returns nothing
 * usable. ally-be used to count that as a judged session: no rows were
 * written, the drainer's breaker never saw a failure, and NOT EXISTS put the
 * session back at the head of the newest-first queue on every tick for up to
 * 150 days — a paid whole-transcript call each time.
 */
describe('FeedbackGroundednessJudgeService', () => {
  const post = axios.post as jest.Mock;

  const session = {
    id: 'sess-1',
    tenant_id: 'tenant-1',
    scenario_id: 3,
    scenario_version_id: null,
    language: 'en',
    llm_model: null,
    occurred_at: new Date('2026-10-01T00:00:00Z'),
  };

  const build = (claims: unknown[] | Error) => {
    const repo = {
      fetchRubric: jest.fn().mockResolvedValue(null),
      selectSessions: jest.fn().mockResolvedValue([session]),
      buildClaims: jest
        .fn()
        .mockResolvedValue([
          { claim_index: 0, kind: 'positive', text: 'You listened well.' },
        ]),
      buildTranscript: jest
        .fn()
        .mockResolvedValue([{ role: 'counselor', text: 'How are you?' }]),
      upsertJudgments: jest.fn().mockResolvedValue(undefined),
    };
    const store = new Map<string, string>();
    const redis = {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
    };
    const attempts = {
      recordFailure: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
    };
    post.mockReset();
    if (claims instanceof Error) post.mockRejectedValue(claims);
    else
      post.mockResolvedValue({
        data: {
          judge_model: 'gemini-2.5-pro',
          judge_prompt_version: 'v1',
          claims,
        },
      });
    const service = new FeedbackGroundednessJudgeService(
      repo as never,
      { ai: { apiUrl: 'http://ai', outboundApiKey: 'k' } } as never,
      redis as never,
      attempts as never,
    );
    return { service, repo, attempts };
  };

  const run = async (
    service: FeedbackGroundednessJudgeService,
    scheduled?: { honourAttemptLedger: boolean },
  ) => {
    const { jobId } = await service.startBackfill(
      150,
      { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v1' },
      1,
      80,
      scheduled,
    );
    for (let i = 0; i < 50; i += 1) {
      const job = await service.getJob(jobId);
      if (job && (job.status === 'done' || job.status === 'error')) return job;
      await new Promise((r) => setImmediate(r));
    }
    throw new Error('job did not settle');
  };

  it('counts an empty answer as failed and records it, rather than as judged', async () => {
    const { service, repo, attempts } = build([]);
    const job = await run(service);

    expect(job.judged).toBe(0);
    // `failed`, so a judge that answers nothing for a whole chunk trips the
    // drainer's breaker instead of reading as a healthy run.
    expect(job.failed).toBe(1);
    expect(repo.upsertJudgments).not.toHaveBeenCalled();
    expect(attempts.recordFailure).toHaveBeenCalledWith(
      'groundedness',
      'sess-1',
      'tenant-1',
      'empty',
      'judge returned no claims',
    );
    expect(attempts.clear).not.toHaveBeenCalled();
  });

  it('records a thrown call as a FAILED attempt', async () => {
    const err = new Error('socket hang up');
    const { service, attempts } = build(err);
    const job = await run(service);

    expect(job.failed).toBe(1);
    expect(attempts.recordFailure).toHaveBeenCalledWith(
      'groundedness',
      'sess-1',
      'tenant-1',
      'failed',
      err,
    );
  });

  it('stores the verdicts and clears the ledger on a real answer', async () => {
    const { service, repo, attempts } = build([
      { claim_index: 0, kind: 'positive', verdict: 'supported' },
    ]);
    const job = await run(service);

    expect(job.judged).toBe(1);
    expect(repo.upsertJudgments).toHaveBeenCalled();
    expect(attempts.clear).toHaveBeenCalledWith('groundedness', 'sess-1');
    expect(attempts.recordFailure).not.toHaveBeenCalled();
  });

  it('honours the ledger only when a scheduled caller asks', async () => {
    const { service, repo } = build([]);
    await run(service, { honourAttemptLedger: true });
    await run(service);

    expect(repo.selectSessions.mock.calls[0][0].honourAttemptLedger).toBe(true);
    expect(repo.selectSessions.mock.calls[1][0].honourAttemptLedger).toBe(
      false,
    );
  });
});
