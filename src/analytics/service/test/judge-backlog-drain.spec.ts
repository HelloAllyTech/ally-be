import { JudgeBacklogDrainService } from '../judge-backlog-drain.service';
import { scheduledTaskRegistry } from '../../../scheduler/registry/scheduled-task.registry';

/**
 * The drainer exists so backfilling is not a thing a person has to remember,
 * stay logged in for, and restart after every deploy. That only holds if it
 * gets four judgements right, none of which a typecheck can see:
 *
 *   - it does not stack a second job on a run that takes hours;
 *   - it stops by itself when the backlog empties, rather than needing an end
 *     date somebody has to remember to remove;
 *   - it restarts a run that a deploy killed, which is the whole point; and
 *   - it gives up on a judge that fails everything, instead of spending money
 *     forever on a run that judges nothing.
 */
describe('JudgeBacklogDrainService', () => {
  const build = (
    opts: {
      driftJob?: {
        status: string;
        judged: number;
        failed: number;
        processed: number;
      };
      eligible?: boolean;
      state?: { jobId?: string; unproductive: number; lastProcessed?: number };
    } = {},
  ) => {
    const store = new Map<string, string>();
    if (opts.state) {
      for (const family of ['drift', 'groundedness', 'language']) {
        store.set(`judge:backlog:${family}`, JSON.stringify(opts.state));
      }
    }

    const analytics = {
      getDriftBackfillStatus: jest.fn().mockResolvedValue(opts.driftJob),
      startDriftBackfill: jest
        .fn()
        .mockResolvedValue({ jobId: 'new-drift-job' }),
    };
    const groundedness = {
      getJob: jest.fn().mockResolvedValue(undefined),
      startBackfill: jest.fn().mockResolvedValue({ jobId: 'new-ground-job' }),
    };
    const language = {
      getJob: jest.fn().mockResolvedValue(undefined),
      startBackfill: jest.fn().mockResolvedValue({ jobId: 'new-lang-job' }),
      topUpRoundTripWer: jest
        .fn()
        .mockResolvedValue({ attempted: 0, measured: 0 }),
    };
    const rows = opts.eligible === false ? [] : [{ id: 's1' }];
    const driftRepo = { selectSessions: jest.fn().mockResolvedValue(rows) };
    const groundednessRepo = {
      selectSessions: jest.fn().mockResolvedValue(rows),
    };
    const languageRepo = { selectSessions: jest.fn().mockResolvedValue(rows) };
    const redis = {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
    };

    const service = new JudgeBacklogDrainService(
      analytics as never,
      groundedness as never,
      language as never,
      driftRepo as never,
      groundednessRepo as never,
      languageRepo as never,
      redis as never,
    );
    return { service, analytics, groundedness, language, driftRepo, store };
  };

  const tick = async (service: JudgeBacklogDrainService) => {
    service.onModuleInit();
    const tasks = scheduledTaskRegistry.getHandlers('30min');
    const drain = tasks
      .filter((t) => t.taskName === 'judge-backlog-drain')
      .pop();
    await drain!.handler();
  };

  it('starts a run when there is a backlog and nothing in flight', async () => {
    const { service, analytics } = build();
    await tick(service);

    expect(analytics.startDriftBackfill).toHaveBeenCalledWith(
      150,
      true,
      { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v2' },
      undefined,
      // The lean source: top up rows judged under v1 rather than re-judging.
      { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v1' },
      // Chunk: one tick's worth, not the whole backlog.
      25,
    );
  });

  it('does not stack a second job while one is running', async () => {
    const { service, analytics } = build({
      driftJob: { status: 'running', judged: 10, failed: 0, processed: 10 },
      state: { jobId: 'in-flight', unproductive: 0, lastProcessed: 5 },
    });
    await tick(service);

    expect(analytics.startDriftBackfill).not.toHaveBeenCalled();
  });

  it('restarts a run a deploy killed', async () => {
    // A killed job leaves its last status behind; it is not running, and the
    // backlog is still there. Restarting is exactly what a person had to do by
    // hand before, token and all.
    const { service, analytics } = build({
      driftJob: { status: 'running', judged: 40, failed: 0, processed: 40 },
      state: { jobId: 'gone', unproductive: 0, lastProcessed: 5 },
    });
    const { service: s2, analytics: a2 } = build({
      driftJob: undefined,
      state: { jobId: 'gone', unproductive: 0 },
    });
    await tick(service);
    expect(analytics.startDriftBackfill).not.toHaveBeenCalled();

    await tick(s2);
    expect(a2.startDriftBackfill).toHaveBeenCalled();
  });

  it('stops on its own once the backlog is empty', async () => {
    const { service, analytics, groundedness, language } = build({
      eligible: false,
    });
    await tick(service);

    expect(analytics.startDriftBackfill).not.toHaveBeenCalled();
    expect(groundedness.startBackfill).not.toHaveBeenCalled();
    expect(language.startBackfill).not.toHaveBeenCalled();
  });

  it('re-judges language into v2, which is what the dashboard pins to', async () => {
    // Language has no lean path: its annotations are DELETEd and re-INSERTed
    // per session, so the whole rubric is re-emitted. Without this, the live
    // catch-up keeps writing v2 for NEW sessions only, the dashboard pins to
    // v2, and 1,776 annotations of history under v1 stay invisible.
    const { service, language } = build();
    await tick(service);

    expect(language.startBackfill).toHaveBeenCalledWith(
      150,
      true,
      { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v2' },
      undefined,
      25,
    );
  });

  it('gives up after repeated runs that judge nothing while failing', async () => {
    // The 426-of-426 failure mode: a broken judge, a backlog that never
    // shrinks, and a drainer that would otherwise restart it forever.
    const { service, analytics } = build({
      driftJob: { status: 'done', judged: 0, failed: 426, processed: 426 },
      state: { jobId: 'broken', unproductive: 3 },
    });
    await tick(service);

    expect(analytics.startDriftBackfill).not.toHaveBeenCalled();
  });

  it('counts a strike but keeps trying below the limit', async () => {
    const { service, analytics, store } = build({
      driftJob: { status: 'done', judged: 0, failed: 12, processed: 12 },
      state: { jobId: 'bad', unproductive: 1 },
    });
    await tick(service);

    expect(analytics.startDriftBackfill).toHaveBeenCalled();
    expect(JSON.parse(store.get('judge:backlog:drift')!).unproductive).toBe(2);
  });

  it('clears strikes after a run that judged something', async () => {
    const { service, store } = build({
      driftJob: { status: 'done', judged: 300, failed: 4, processed: 304 },
      state: { jobId: 'good', unproductive: 2 },
    });
    await tick(service);

    // A few failures among real work is normal; only judging NOTHING counts.
    expect(JSON.parse(store.get('judge:backlog:drift')!).unproductive).toBe(0);
  });

  /**
   * The case the drainer exists for, and the one it originally got wrong.
   *
   * A deploy kills the process holding the loop WITHOUT updating the job
   * record, so Redis keeps saying "running" until its own hour-long TTL
   * expires. In production the 19:00 tick skipped both stalled families for
   * exactly this reason, leaving them dead for an hour while reporting healthy.
   * Progress, not status, is what proves a job is alive.
   */
  it('restarts a job that says running but has stopped advancing', async () => {
    const { service, analytics } = build({
      driftJob: { status: 'running', judged: 40, failed: 0, processed: 40 },
      // Same processed count the previous tick recorded — nothing moved in 30
      // minutes, and a live job advances within ~60s.
      state: { jobId: 'killed-by-deploy', unproductive: 0, lastProcessed: 40 },
    });
    await tick(service);

    expect(analytics.startDriftBackfill).toHaveBeenCalled();
  });

  it('leaves a job alone while it is still advancing', async () => {
    const { service, analytics, store } = build({
      driftJob: { status: 'running', judged: 60, failed: 0, processed: 60 },
      state: { jobId: 'alive', unproductive: 0, lastProcessed: 40 },
    });
    await tick(service);

    expect(analytics.startDriftBackfill).not.toHaveBeenCalled();
    // The new high-water mark is remembered, or the next tick would see no
    // movement and kill a perfectly healthy run.
    expect(JSON.parse(store.get('judge:backlog:drift')!).lastProcessed).toBe(
      60,
    );
  });

  it('bounds every family to a chunk instead of the whole backlog', () => {
    // The restart-resilience property, asserted as arithmetic rather than as
    // behaviour: an unbounded run takes hours, so a deploy kills it mid-flight
    // and the service has to work out that a job claiming to be "running" is
    // held by a process that no longer exists. Three deploys in one morning
    // cost about three hours that way. A bounded run finishes inside the tick,
    // and an interrupted one costs only the sessions in flight because the
    // selectors already skip everything judged.
    const { service, analytics, groundedness, language } = build();
    return tick(service).then(() => {
      // The chunk is the LAST argument in all three signatures. Reaching for
      // "the first number" would pick up the 150-day window instead, which is
      // how this test failed the first time it was written.
      const chunkOf = (call: unknown[]) => call[call.length - 1];
      expect(chunkOf(analytics.startDriftBackfill.mock.calls[0])).toBe(25);
      expect(chunkOf(groundedness.startBackfill.mock.calls[0])).toBe(25);
      expect(chunkOf(language.startBackfill.mock.calls[0])).toBe(25);
    });
  });

  it('tops up round-trip WER on every tick', async () => {
    // It is deliberately not part of judging — a TTS+ASR round trip held a
    // judging worker for three minutes whenever the vendor was slow, on a field
    // that renders as "not measured" either way. So it needs its own step, or
    // it simply never runs.
    const { service, language } = build();
    await tick(service);

    expect(language.topUpRoundTripWer).toHaveBeenCalledWith(
      { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v2' },
      40,
    );
  });

  it('does not let a speech-vendor failure sink the tick', async () => {
    // The top-up runs last, but a throw there would still surface as an
    // unhandled rejection on the scheduler and obscure three families that
    // completed fine.
    const { service, language } = build();
    language.topUpRoundTripWer.mockRejectedValue(new Error('sarvam is down'));

    await expect(tick(service)).resolves.not.toThrow();
  });
});
