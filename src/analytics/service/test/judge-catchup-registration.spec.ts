import { scheduledTaskRegistry } from '../../../scheduler/registry/scheduled-task.registry';
import { DriftBackfillSchedulerRegistrationService } from '../drift-backfill-scheduler-registration.service';
import { LanguageBackfillSchedulerRegistrationService } from '../language-backfill-scheduler-registration.service';

/**
 * The two live catch-ups started a fresh job on every tick, whether or not the
 * last one had finished. A job is fire-and-forget, so the scheduler's advisory
 * lock was released long before the work ended and stopped nothing: an
 * overrunning run got a second one started beside it, both selecting the same
 * unjudged sessions and both paying for them.
 *
 * These pin the guard: skip while the previous run is alive, replace it when
 * it has stopped moving (a deploy kills the loop without updating its record),
 * and start normally once it is done.
 */
describe('judge catch-up registration', () => {
  type Job = { status: string; processed: number } | undefined;

  const redisStub = () => {
    const store = new Map<string, string>();
    return {
      store,
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
    };
  };

  const handler = (taskName: string) =>
    scheduledTaskRegistry
      .getHandlers('30min')
      .filter((t) => t.taskName === taskName)
      .pop()!.handler;

  describe('language', () => {
    const build = (previous?: { job: Job; lastProcessed?: number }) => {
      const redis = redisStub();
      if (previous) {
        redis.store.set(
          'judge:catchup:language',
          JSON.stringify({
            jobId: 'prev-job',
            lastProcessed: previous.lastProcessed,
          }),
        );
      }
      const languageJudge = {
        getJob: jest.fn().mockResolvedValue(previous?.job),
        startBackfill: jest.fn().mockResolvedValue({ jobId: 'new-job' }),
      };
      const service = new LanguageBackfillSchedulerRegistrationService(
        languageJudge as never,
        redis as never,
      );
      service.onModuleInit();
      return { languageJudge, redis, run: handler('language-judge-catchup') };
    };

    it('starts a run over the last day, honouring the attempt ledger', async () => {
      const { languageJudge, redis, run } = build();
      await run();

      expect(languageJudge.startBackfill).toHaveBeenCalledWith(
        1,
        true,
        undefined,
        undefined,
        undefined,
        { honourAttemptLedger: true },
      );
      expect(JSON.parse(redis.store.get('judge:catchup:language')!)).toEqual({
        jobId: 'new-job',
      });
    });

    it('skips the tick while the previous run is still advancing', async () => {
      const { languageJudge, redis, run } = build({
        job: { status: 'running', processed: 12 },
        lastProcessed: 4,
      });
      await run();

      expect(languageJudge.startBackfill).not.toHaveBeenCalled();
      // The new high-water mark is remembered, or the next tick would see no
      // movement and kill a healthy run.
      expect(JSON.parse(redis.store.get('judge:catchup:language')!)).toEqual({
        jobId: 'prev-job',
        lastProcessed: 12,
      });
    });

    it('skips a run that is queued and has not been seen before', async () => {
      const { languageJudge, run } = build({
        job: { status: 'queued', processed: 0 },
      });
      await run();

      expect(languageJudge.startBackfill).not.toHaveBeenCalled();
    });

    it('replaces a run that reports running but has not moved in a tick', async () => {
      const { languageJudge, run } = build({
        job: { status: 'running', processed: 12 },
        lastProcessed: 12,
      });
      await run();

      expect(languageJudge.startBackfill).toHaveBeenCalledTimes(1);
    });

    it('starts again once the previous run is done', async () => {
      const { languageJudge, run } = build({
        job: { status: 'done', processed: 30 },
        lastProcessed: 20,
      });
      await run();

      expect(languageJudge.startBackfill).toHaveBeenCalledTimes(1);
    });

    it('starts again when the previous record has expired', async () => {
      const { languageJudge, run } = build({ job: undefined });
      await run();

      expect(languageJudge.startBackfill).toHaveBeenCalledTimes(1);
    });
  });

  describe('drift', () => {
    const build = (job: Job, lastProcessed?: number) => {
      const redis = redisStub();
      redis.store.set(
        'judge:catchup:drift',
        JSON.stringify({ jobId: 'prev-job', lastProcessed }),
      );
      const analytics = {
        getDriftBackfillStatus: jest.fn().mockResolvedValue(job),
        startDriftBackfill: jest.fn().mockResolvedValue({ jobId: 'new-job' }),
      };
      const service = new DriftBackfillSchedulerRegistrationService(
        analytics as never,
        redis as never,
      );
      service.onModuleInit();
      return { analytics, run: handler('drift-catchup') };
    };

    it('skips the tick while the previous run is still advancing', async () => {
      const { analytics, run } = build({ status: 'running', processed: 3 });
      await run();

      expect(analytics.startDriftBackfill).not.toHaveBeenCalled();
    });

    it('starts a full judge over the last day, honouring the ledger', async () => {
      // getDriftBackfillStatus answers an expired id with status 'error'.
      const { analytics, run } = build({ status: 'error', processed: 0 });
      await run();

      expect(analytics.startDriftBackfill).toHaveBeenCalledWith(
        1,
        true,
        undefined,
        undefined,
        undefined, // never lean: live sessions get a complete judgment
        undefined,
        { honourAttemptLedger: true },
      );
    });
  });
});
