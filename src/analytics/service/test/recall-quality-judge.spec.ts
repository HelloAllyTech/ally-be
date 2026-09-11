import axios from 'axios';
import { RecallQualityJudgeService } from '../recall-quality-judge.service';

jest.mock('axios');

/**
 * Two judgements here that a typecheck cannot see, and both are about not manufacturing a
 * finding:
 *
 *   - a turn whose transcript cannot support its index is SKIPPED, never judged against
 *     whatever text is nearby. A verdict on the wrong turn reads exactly like a real one.
 *   - a failed call counts as `failed`, never as `no_demand`. Conflating them would inflate
 *     the bucket that means "recall was not needed here" with our own outages.
 */
describe('RecallQualityJudgeService', () => {
  const post = axios.post as jest.Mock;

  const turn = (over: Record<string, unknown> = {}) => ({
    id: 'sel-1',
    tenant_id: 'tenant-1',
    scenario_session_id: 'sess-1',
    turn_index: 2,
    stance: 'guarded',
    cue_tier: 'nominated',
    pool_size: 12,
    selected: [{ text: 'she ran a tailoring shop' }],
    passed_over: [{ text: 'her son stopped visiting' }],
    occurred_at: new Date('2026-09-11T09:00:00Z'),
    ...over,
  });

  const build = (
    opts: {
      turns?: Record<string, unknown>[];
      text?: { counsellor_turn: string; client_reply: string } | null;
      response?: unknown;
    } = {},
  ) => {
    const repo = {
      fetchRubric: jest.fn().mockResolvedValue(null),
      selectTurns: jest.fn().mockResolvedValue(opts.turns ?? [turn()]),
      buildTurnText: jest.fn().mockResolvedValue(
        opts.text === undefined
          ? {
              counsellor_turn: 'Tell me about your family.',
              client_reply: "There's not much to tell.",
            }
          : opts.text,
      ),
      upsertJudgment: jest.fn().mockResolvedValue(undefined),
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
        judgment: { verdict: 'well_chosen', unused_selected: [] },
      },
    });
    return {
      service: new RecallQualityJudgeService(
        repo as never,
        { ai: { apiUrl: 'http://ai.test', outboundApiKey: 'k' } } as never,
        redis as never,
      ),
      repo,
    };
  };

  const run = async (service: RecallQualityJudgeService) => {
    const started = await service.startBackfill(7, null, 1, null);
    for (let i = 0; i < 50; i += 1) {
      const job = await service.getJob(started.jobId);
      if (job && (job.status === 'done' || job.status === 'error')) return job;
      await new Promise((r) => setImmediate(r));
    }
    throw new Error('job did not settle');
  };

  it('judges a turn and records the verdict', async () => {
    const { service, repo } = build();
    const job = await run(service);
    expect(job.judged).toBe(1);
    expect(repo.upsertJudgment).toHaveBeenCalled();
  });

  it('skips a turn the transcript cannot support rather than guessing', async () => {
    const { service, repo } = build({ text: null });
    const job = await run(service);

    expect(post).not.toHaveBeenCalled();
    expect(job.skipped).toBe(1);
    expect(job.judged).toBe(0);
    expect(repo.upsertJudgment).not.toHaveBeenCalled();
  });

  it('counts a verdictless response as failed, not as no_demand', async () => {
    const { service, repo } = build({
      response: {
        judge_model: 'gemini-2.5-pro',
        judge_prompt_version: 'v1',
        judgment: null,
      },
    });
    const job = await run(service);

    expect(job.failed).toBe(1);
    expect(job.noDemand).toBe(0);
    expect(repo.upsertJudgment).not.toHaveBeenCalled();
  });

  it('counts the two failure verdicts separately, because the fixes differ', async () => {
    const { service } = build({
      turns: [turn({ id: 'a' }), turn({ id: 'b' })],
    });
    post
      .mockResolvedValueOnce({
        data: {
          judge_model: 'gemini-2.5-pro',
          judge_prompt_version: 'v1',
          judgment: {
            verdict: 'missed_better',
            better_fact: 'her son stopped visiting',
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          judge_model: 'gemini-2.5-pro',
          judge_prompt_version: 'v1',
          judgment: { verdict: 'nothing_apt' },
        },
      });
    const job = await run(service);

    expect(job.missedBetter).toBe(1);
    expect(job.nothingApt).toBe(1);
  });

  it('counts no_demand, which is what the failures must be read against', async () => {
    const { service } = build({
      response: {
        judge_model: 'gemini-2.5-pro',
        judge_prompt_version: 'v1',
        judgment: { verdict: 'no_demand' },
      },
    });
    const job = await run(service);
    expect(job.noDemand).toBe(1);
    expect(job.judged).toBe(1);
  });

  it('sends the turn, both candidate lists and the stance', async () => {
    // Without the stance a guarded client's withholding reads as a recall failure.
    const { service } = build();
    await run(service);

    const [url, body, config] = post.mock.calls[0];
    expect(url).toBe('http://ai.test/api/v1/recall-quality/judge');
    expect(body.counsellor_turn).toBe('Tell me about your family.');
    expect(body.client_reply).toBe("There's not much to tell.");
    expect(body.selected[0].text).toBe('she ran a tailoring shop');
    expect(body.passed_over[0].text).toBe('her son stopped visiting');
    expect(body.stance).toBe('guarded');
    expect(body.cue_tier).toBe('nominated');
    expect(config.headers['x-api-key']).toBe('k');
  });

  it('persists the model that actually ran', async () => {
    const { service, repo } = build({
      response: {
        judge_model: 'gemini-2.5-flash',
        judge_prompt_version: 'v1',
        judgment: { verdict: 'well_chosen' },
      },
    });
    await run(service);
    const call = repo.upsertJudgment.mock.calls[0];
    expect(call[2]).toBe('gemini-2.5-flash');
  });

  it('keeps going when one turn throws', async () => {
    const { service } = build({
      turns: [turn({ id: 'a' }), turn({ id: 'b' })],
    });
    post.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({
      data: {
        judge_model: 'gemini-2.5-pro',
        judge_prompt_version: 'v1',
        judgment: { verdict: 'well_chosen' },
      },
    });
    const job = await run(service);

    expect(job.status).toBe('done');
    expect(job.failed).toBe(1);
    expect(job.judged).toBe(1);
  });

  it('asks only for turns unjudged under the target version, in a short window', async () => {
    // Seven days: the ranking's weights are the subject, so a turn judged from before a
    // coefficient changed describes a ranking nobody is running.
    const { service, repo } = build();
    await service.startBackfill(
      7,
      { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v1' },
      1,
      60,
    );
    await new Promise((r) => setImmediate(r));
    const [opts] = repo.selectTurns.mock.calls[0];
    expect(opts.sinceDays).toBe(7);
    expect(opts.limit).toBe(60);
    expect(opts.unjudgedForVersion).toEqual({
      judgeModel: 'gemini-2.5-pro',
      judgePromptVersion: 'v1',
    });
  });
});
