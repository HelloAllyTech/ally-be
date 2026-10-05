import axios from 'axios';
import { DriftJudgeService } from '../drift-judge.service';
import { FeedbackGroundednessJudgeService } from '../feedback-groundedness-judge.service';
import { FillerJudgeService } from '../filler-judge.service';
import { LanguageJudgeService } from '../language-judge.service';

jest.mock('axios');

/**
 * Every session-scoped judge names the session it is judging to ally-ai.
 *
 * ally-ai's judges are stateless and were sent no session id at all, so their
 * llm_usage rows could not be attributed to anything: the judge spend on a
 * session was invisible beside that session's cost. `scenario_session_id` on
 * the request is what ally-ai stamps on the usage row. It is attribution only —
 * these tasks are absent from the session-cost map, so they land as the
 * session's analysis spend, never its delivery cost.
 */
describe('judge requests carry the session they judge', () => {
  const post = axios.post as jest.Mock;
  const config = { ai: { apiUrl: 'http://ai', outboundApiKey: 'k' } };

  const redis = () => {
    const store = new Map<string, string>();
    return {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
    };
  };

  // The judge_attempts ledger; attribution doesn't depend on it.
  const attempts = () => ({
    recordFailure: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  });

  const settle = async (
    getJob: (id: string) => Promise<{ status: string } | undefined>,
    jobId: string,
  ) => {
    for (let i = 0; i < 50; i += 1) {
      const job = await getJob(jobId);
      if (job && (job.status === 'done' || job.status === 'error')) return job;
      await new Promise((r) => setImmediate(r));
    }
    throw new Error('job did not settle');
  };

  const session = {
    id: 'sess-42',
    tenant_id: 'tenant-1',
    scenario_id: 7,
    scenario_version_id: null,
    persona: 'Asha',
    language: 'en',
  };

  const transcript = {
    transcript: [{ role: 'client', turn_index: 1, text: 'hello' }],
    aiText: { 1: 'hello' },
    userText: {},
  };

  beforeEach(() => post.mockReset());

  describe('drift', () => {
    const build = () => {
      const repo = {
        fetchRubric: jest.fn().mockResolvedValue(null),
        selectSessions: jest.fn().mockResolvedValue([session]),
        buildTranscript: jest.fn().mockResolvedValue(transcript),
        upsertJudgments: jest.fn().mockResolvedValue(undefined),
        mergeLeanLabels: jest.fn().mockResolvedValue(undefined),
      };
      const service = new DriftJudgeService(
        repo as never,
        config as never,
        redis() as never,
        attempts() as never,
      );
      return { service, repo };
    };

    it('sends it on the full judge', async () => {
      post.mockResolvedValue({
        data: {
          judge_model: 'gemini-2.5-pro',
          judge_prompt_version: 'v2',
          result: { per_turn: [], session: { drifted: false } },
        },
      });
      const { service, repo } = build();

      const job = await service.startBackfill(1, true);
      expect((await settle((id) => service.getJob(id), job.jobId)).status).toBe(
        'done',
      );

      const [url, body] = post.mock.calls[0];
      expect(url).toBe('http://ai/api/v1/drift/judge');
      expect(body.scenario_session_id).toBe('sess-42');
      expect(repo.upsertJudgments).toHaveBeenCalled();
    });

    it('sends it on the lean labels-only top-up', async () => {
      post.mockResolvedValue({
        data: {
          judge_model: 'gemini-2.5-pro',
          judge_prompt_version: 'v2',
          per_turn: [],
        },
      });
      const { service, repo } = build();

      const job = await service.startBackfill(
        30,
        true,
        { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v2' },
        1,
        { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v1' },
      );
      await settle((id) => service.getJob(id), job.jobId);

      const [url, body] = post.mock.calls[0];
      expect(url).toBe('http://ai/api/v1/drift/judge-labels');
      expect(body.scenario_session_id).toBe('sess-42');
      expect(repo.mergeLeanLabels).toHaveBeenCalled();
    });
  });

  it('sends it on the language judge', async () => {
    post.mockResolvedValue({
      data: {
        judge_model: 'gemini-2.5-pro',
        judge_prompt_version: 'v1',
        result: { per_turn: [] },
      },
    });
    const repo = {
      fetchRubric: jest.fn().mockResolvedValue(null),
      selectSessions: jest.fn().mockResolvedValue([
        {
          ...session,
          language_label: 'English',
          eval_config: null,
          register_directive_configured: false,
          style_exemplars_configured: false,
          allowed_fillers: [],
          engine: null,
        },
      ]),
      persistJudgment: jest.fn().mockResolvedValue(undefined),
    };
    const driftRepo = {
      buildTranscript: jest.fn().mockResolvedValue(transcript),
    };
    const varietyProfileService = {
      resolveVarietyOverride: jest.fn().mockResolvedValue(null),
    };
    const service = new LanguageJudgeService(
      repo as never,
      driftRepo as never,
      config as never,
      redis() as never,
      varietyProfileService as never,
      attempts() as never,
    );

    const job = await service.startBackfill(1, true);
    expect((await settle((id) => service.getJob(id), job.jobId)).status).toBe(
      'done',
    );

    const [url, body] = post.mock.calls[0];
    expect(url).toBe('http://ai/api/v1/language-quality/judge');
    expect(body.scenario_session_id).toBe('sess-42');
    expect(repo.persistJudgment).toHaveBeenCalled();
  });

  it('sends it on the feedback-groundedness judge', async () => {
    post.mockResolvedValue({
      data: {
        judge_model: 'gemini-2.5-pro',
        judge_prompt_version: 'v1',
        claims: [{ claim_index: 0, kind: 'positive', verdict: 'supported' }],
      },
    });
    const repo = {
      fetchRubric: jest.fn().mockResolvedValue(null),
      selectSessions: jest.fn().mockResolvedValue([session]),
      buildClaims: jest
        .fn()
        .mockResolvedValue([
          { claim_index: 0, kind: 'positive', text: 'You reflected feelings.' },
        ]),
      buildTranscript: jest
        .fn()
        .mockResolvedValue([{ role: 'counselor', text: 'That sounds hard.' }]),
      upsertJudgments: jest.fn().mockResolvedValue(undefined),
    };
    const service = new FeedbackGroundednessJudgeService(
      repo as never,
      config as never,
      redis() as never,
      attempts() as never,
    );

    const job = await service.startBackfill(1);
    expect((await settle((id) => service.getJob(id), job.jobId)).status).toBe(
      'done',
    );

    const [url, body] = post.mock.calls[0];
    expect(url).toBe('http://ai/api/v1/feedback-groundedness/judge');
    expect(body.scenario_session_id).toBe('sess-42');
    expect(repo.upsertJudgments).toHaveBeenCalled();
  });

  it('sends it on the filler judge, and not on the version probe', async () => {
    post.mockResolvedValue({
      data: {
        judge_model: 'gemini-2.5-flash',
        judge_prompt_version: 'v1',
        result: { per_filler: [] },
      },
    });
    const repo = {
      selectSessions: jest
        .fn()
        .mockResolvedValue([{ ...session, allowed_fillers: [] }]),
      buildObservations: jest
        .fn()
        .mockResolvedValue([{ turn_index: 1, text: 'Hmm, let me think.' }]),
      persistJudgment: jest.fn().mockResolvedValue(undefined),
    };
    const service = new FillerJudgeService(
      repo as never,
      config as never,
      redis() as never,
    );

    const job = await service.startBackfill({});
    expect((await settle((id) => service.getJob(id), job.jobId)).status).toBe(
      'done',
    );

    // The probe makes no model call, so there is nothing to attribute.
    const [, probeBody] = post.mock.calls[0];
    expect(probeBody.observations).toEqual([]);
    expect(probeBody.scenario_session_id).toBeUndefined();

    const [url, body] = post.mock.calls[1];
    expect(url).toBe('http://ai/api/v1/filler-quality/judge');
    expect(body.scenario_session_id).toBe('sess-42');
    expect(repo.persistJudgment).toHaveBeenCalled();
  });
});
