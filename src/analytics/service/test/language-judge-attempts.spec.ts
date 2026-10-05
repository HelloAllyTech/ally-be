import axios from 'axios';
import { LanguageJudgeService } from '../language-judge.service';

jest.mock('axios');

/**
 * A failed or timed-out language call writes no judgment row, which is what
 * both the catch-up and the drainer select for — so it was re-bought on every
 * tick inside their windows. These pin the ledger writes and the scheduled
 * options a run passes down to its selector.
 */
describe('LanguageJudgeService attempt ledger', () => {
  const post = axios.post as jest.Mock;

  const session = {
    id: 'sess-1',
    tenant_id: 'tenant-1',
    scenario_id: 7,
    scenario_version_id: null,
    language: 'ta-IN',
    language_label: 'Tamil',
    eval_config: null,
    persona: 'a client',
    prompt_versions: null,
    occurred_at: new Date('2026-10-01T00:00:00Z'),
    llm_provider: null,
    llm_model: null,
    engine: null,
    register_directive_configured: false,
    style_exemplars_configured: false,
    allowed_fillers: null,
    tts_provider: null,
    tts_voice_config: null,
    voice_id: null,
    voice_name: null,
  };

  const build = () => {
    const repo = {
      fetchRubric: jest.fn().mockResolvedValue(null),
      selectSessions: jest.fn().mockResolvedValue([session]),
      persistJudgment: jest.fn().mockResolvedValue(undefined),
    };
    const driftRepo = {
      buildTranscript: jest.fn().mockResolvedValue({
        transcript: [{ role: 'client', turn_index: 0, text: 'vanakkam' }],
        aiText: { 0: 'vanakkam' },
        userText: { 0: '' },
      }),
    };
    const store = new Map<string, string>();
    const redis = {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
    };
    const varietyProfileService = {
      resolveVarietyOverride: jest.fn().mockResolvedValue(null),
    };
    const attempts = {
      recordFailure: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
    };
    post.mockReset();
    post.mockResolvedValue({
      data: {
        judge_model: 'gemini-2.5-pro',
        judge_prompt_version: 'v2',
        result: { per_turn: [], turns_judged: 1, dropped_annotations: 0 },
      },
    });
    const service = new LanguageJudgeService(
      repo as never,
      driftRepo as never,
      { ai: { apiUrl: 'http://ai', outboundApiKey: 'k' } } as never,
      redis as never,
      varietyProfileService as never,
      attempts as never,
    );
    return { service, repo, attempts };
  };

  const settle = async (service: LanguageJudgeService, jobId: string) => {
    for (let i = 0; i < 50; i += 1) {
      const job = await service.getJob(jobId);
      if (job && (job.status === 'done' || job.status === 'error')) return job;
      await new Promise((r) => setImmediate(r));
    }
    throw new Error('job did not settle');
  };

  it('records a timed-out call against the session', async () => {
    // ally-ai keeps running — and billing — after ally-be's 600s timeout, so
    // a timeout is a paid attempt like any other.
    const { service, attempts, repo } = build();
    const timeout = Object.assign(new Error('timeout of 600000ms exceeded'), {
      isAxiosError: true,
      code: 'ECONNABORTED',
    });
    post.mockRejectedValue(timeout);

    const { jobId } = await service.startBackfill(1, true);
    const job = await settle(service, jobId);

    expect(job.failed).toBe(1);
    expect(repo.persistJudgment).not.toHaveBeenCalled();
    expect(attempts.recordFailure).toHaveBeenCalledWith(
      'language',
      'sess-1',
      'tenant-1',
      'failed',
      timeout,
    );
  });

  it('clears the ledger once the session is judged', async () => {
    const { service, attempts } = build();

    const { jobId } = await service.startBackfill(1, true);
    const job = await settle(service, jobId);

    expect(job.judged).toBe(1);
    expect(attempts.clear).toHaveBeenCalledWith('language', 'sess-1');
    expect(attempts.recordFailure).not.toHaveBeenCalled();
  });

  it("passes a scheduled run's options to the selector, and a manual run's none", async () => {
    const { service, repo } = build();

    const scheduled = await service.startBackfill(
      150,
      true,
      { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v2' },
      undefined,
      80,
      { honourAttemptLedger: true, excludeCreatedWithinHours: 26 },
    );
    await settle(service, scheduled.jobId);
    // The admin endpoint's shape: no scheduled options, so no ledger cap — an
    // operator re-running after an outage reaches the sessions that hit it.
    const manual = await service.startBackfill(90, true, null, 5);
    await settle(service, manual.jobId);

    expect(repo.selectSessions.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        honourAttemptLedger: true,
        excludeCreatedWithinHours: 26,
        limit: 80,
      }),
    );
    expect(repo.selectSessions.mock.calls[1][0]).not.toHaveProperty(
      'honourAttemptLedger',
    );
    expect(repo.selectSessions.mock.calls[1][0]).not.toHaveProperty(
      'excludeCreatedWithinHours',
    );
  });
});
