import axios from 'axios';
import { DriftJudgeService } from '../drift-judge.service';

jest.mock('axios');

/**
 * A drift call that fails, times out or stores nothing writes no judgment row,
 * and "no judgment row" is exactly what the catch-up and the drainer select
 * for. These pin the ledger writes that stop that being a retry-every-tick
 * loop, and the switch that keeps a manual re-run uncapped.
 */
describe('DriftJudgeService attempt ledger', () => {
  const post = axios.post as jest.Mock;

  const session = {
    id: 'sess-1',
    tenant_id: 'tenant-1',
    scenario_id: 7,
    scenario_version_id: null,
    language: 'en',
    persona: 'a client',
    prompt_versions: null,
    occurred_at: new Date('2026-10-01T00:00:00Z'),
    llm_provider: null,
    llm_model: null,
  };

  const build = () => {
    const repo = {
      fetchRubric: jest.fn().mockResolvedValue(null),
      selectSessions: jest.fn().mockResolvedValue([session]),
      buildTranscript: jest.fn().mockResolvedValue({
        transcript: [{ role: 'client', turn_index: 0, text: 'hello' }],
        aiText: { 0: 'hello' },
        userText: { 0: '' },
      }),
      upsertJudgments: jest.fn().mockResolvedValue(undefined),
      mergeLeanLabels: jest.fn().mockResolvedValue(1),
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
    const service = new DriftJudgeService(
      repo as never,
      { ai: { apiUrl: 'http://ai', outboundApiKey: 'k' } } as never,
      redis as never,
      attempts as never,
    );
    post.mockReset();
    post.mockResolvedValue({
      data: {
        judge_model: 'gemini-2.5-pro',
        judge_prompt_version: 'v2',
        result: {
          per_turn: [{ turn_index: 0 }],
          session: { drifted: false, first_drift_turn: null },
        },
        per_turn: [{ turn_index: 0, role_inversion: false }],
      },
    });
    return { service, repo, attempts };
  };

  const settle = async (service: DriftJudgeService, jobId: string) => {
    for (let i = 0; i < 50; i += 1) {
      const job = await service.getJob(jobId);
      if (job && (job.status === 'done' || job.status === 'error')) return job;
      await new Promise((r) => setImmediate(r));
    }
    throw new Error('job did not settle');
  };

  it('records a failed call against the session', async () => {
    const { service, attempts } = build();
    const err = Object.assign(
      new Error('Request failed with status code 500'),
      {
        isAxiosError: true,
        response: { status: 500 },
      },
    );
    post.mockRejectedValue(err);

    const { jobId } = await service.startBackfill(1, true);
    const job = await settle(service, jobId);

    expect(job.failed).toBe(1);
    expect(attempts.recordFailure).toHaveBeenCalledWith(
      'drift',
      'sess-1',
      'tenant-1',
      'failed',
      err,
    );
    expect(attempts.clear).not.toHaveBeenCalled();
  });

  it('clears the ledger once the session is judged', async () => {
    const { service, attempts, repo } = build();

    const { jobId } = await service.startBackfill(1, true);
    const job = await settle(service, jobId);

    expect(job.judged).toBe(1);
    expect(repo.upsertJudgments).toHaveBeenCalled();
    expect(attempts.clear).toHaveBeenCalledWith('drift', 'sess-1');
    expect(attempts.recordFailure).not.toHaveBeenCalled();
  });

  it('records a lean top-up that stored nothing as an EMPTY attempt', async () => {
    // Nothing landed under v2, so the session still reads as un-topped-up and
    // the drainer would buy the same labels again on the next tick.
    const { service, attempts, repo } = build();
    repo.mergeLeanLabels.mockResolvedValue(0);

    const { jobId } = await service.startBackfill(
      150,
      true,
      { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v2' },
      undefined,
      { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v1' },
      80,
      { honourAttemptLedger: true },
    );
    const job = await settle(service, jobId);

    expect(job.failed).toBe(1);
    expect(job.judged).toBe(0);
    expect(attempts.recordFailure).toHaveBeenCalledWith(
      'drift',
      'sess-1',
      'tenant-1',
      'empty',
      expect.any(String),
    );
  });

  it('honours the ledger only for a scheduled caller', async () => {
    // The admin "Re-run" passes nothing: an operator recovering sessions that
    // hit the cap during an outage must be able to reach them.
    const { service, repo } = build();

    const scheduled = await service.startBackfill(
      1,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      { honourAttemptLedger: true },
    );
    await settle(service, scheduled.jobId);
    const manual = await service.startBackfill(90, false);
    await settle(service, manual.jobId);

    expect(repo.selectSessions.mock.calls[0][0].honourAttemptLedger).toBe(true);
    expect(repo.selectSessions.mock.calls[1][0].honourAttemptLedger).toBe(
      false,
    );
  });
});
