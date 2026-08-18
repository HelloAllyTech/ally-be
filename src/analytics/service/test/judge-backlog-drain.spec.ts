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
      driftJob?: { status: string; judged: number; failed: number };
      eligible?: boolean;
      state?: { jobId?: string; unproductive: number };
    } = {},
  ) => {
    const store = new Map<string, string>();
    if (opts.state) {
      store.set('judge:backlog:drift', JSON.stringify(opts.state));
      store.set('judge:backlog:groundedness', JSON.stringify(opts.state));
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
    const rows = opts.eligible === false ? [] : [{ id: 's1' }];
    const driftRepo = { selectSessions: jest.fn().mockResolvedValue(rows) };
    const groundednessRepo = {
      selectSessions: jest.fn().mockResolvedValue(rows),
    };
    const redis = {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
    };

    const service = new JudgeBacklogDrainService(
      analytics as never,
      groundedness as never,
      driftRepo as never,
      groundednessRepo as never,
      redis as never,
    );
    return { service, analytics, groundedness, driftRepo, store };
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
      30,
      true,
      { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v2' },
      undefined,
      // The lean source: top up rows judged under v1 rather than re-judging.
      { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v1' },
    );
  });

  it('does not stack a second job while one is running', async () => {
    const { service, analytics } = build({
      driftJob: { status: 'running', judged: 10, failed: 0 },
      state: { jobId: 'in-flight', unproductive: 0 },
    });
    await tick(service);

    expect(analytics.startDriftBackfill).not.toHaveBeenCalled();
  });

  it('restarts a run a deploy killed', async () => {
    // A killed job leaves its last status behind; it is not running, and the
    // backlog is still there. Restarting is exactly what a person had to do by
    // hand before, token and all.
    const { service, analytics } = build({
      driftJob: { status: 'running', judged: 40, failed: 0 },
      state: { jobId: 'gone', unproductive: 0 },
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
    const { service, analytics, groundedness } = build({ eligible: false });
    await tick(service);

    expect(analytics.startDriftBackfill).not.toHaveBeenCalled();
    expect(groundedness.startBackfill).not.toHaveBeenCalled();
  });

  it('gives up after repeated runs that judge nothing while failing', async () => {
    // The 426-of-426 failure mode: a broken judge, a backlog that never
    // shrinks, and a drainer that would otherwise restart it forever.
    const { service, analytics } = build({
      driftJob: { status: 'done', judged: 0, failed: 426 },
      state: { jobId: 'broken', unproductive: 3 },
    });
    await tick(service);

    expect(analytics.startDriftBackfill).not.toHaveBeenCalled();
  });

  it('counts a strike but keeps trying below the limit', async () => {
    const { service, analytics, store } = build({
      driftJob: { status: 'done', judged: 0, failed: 12 },
      state: { jobId: 'bad', unproductive: 1 },
    });
    await tick(service);

    expect(analytics.startDriftBackfill).toHaveBeenCalled();
    expect(JSON.parse(store.get('judge:backlog:drift')!).unproductive).toBe(2);
  });

  it('clears strikes after a run that judged something', async () => {
    const { service, store } = build({
      driftJob: { status: 'done', judged: 300, failed: 4 },
      state: { jobId: 'good', unproductive: 2 },
    });
    await tick(service);

    // A few failures among real work is normal; only judging NOTHING counts.
    expect(JSON.parse(store.get('judge:backlog:drift')!).unproductive).toBe(0);
  });
});
