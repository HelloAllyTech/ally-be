/** The slice of a backfill job record this guard reads. */
export interface CatchupJobProgress {
  status: string;
  processed: number;
}

/** What is kept in Redis between ticks, per catch-up. */
interface CatchupState {
  jobId?: string;
  lastProcessed?: number;
}

/**
 * Start a live catch-up run, unless the previous one is still working.
 *
 * The catch-ups used to start a fresh job on every tick regardless. A job is
 * fire-and-forget — `startBackfill` returns as soon as the job is queued — so
 * the scheduler's advisory lock is released long before the work finishes and
 * guards nothing here. A run that outlasted its tick (a backlog after an
 * outage, a slow judge) had a second run started beside it, both selecting
 * the same unjudged sessions and both paying for them.
 *
 * Same rule as the backlog drainer's `shouldStart`, for the same reasons:
 * remember the job id in Redis, and skip while that job is `queued` or
 * `running` AND has advanced since the previous tick. "running" alone is not
 * proof of life — a deploy kills the loop without updating the record, which
 * then reads "running" until its hour-long TTL lapses — so a job that has not
 * moved in a whole tick is treated as dead and replaced. A judge call takes
 * about a minute, so a live job always moves within thirty.
 */
export async function startCatchupUnlessRunning(opts: {
  /** Names the Redis key: `judge:catchup:<family>`. */
  family: string;
  redis: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<unknown>;
  };
  logger: { warn(message: string): void };
  getJob: (jobId: string) => Promise<CatchupJobProgress | undefined>;
  start: () => Promise<{ jobId: string }>;
}): Promise<{ started: boolean; jobId?: string }> {
  const key = `judge:catchup:${opts.family}`;
  let state: CatchupState = {};
  try {
    const raw = await opts.redis.get(key);
    state = raw ? (JSON.parse(raw) as CatchupState) : {};
  } catch {
    state = {};
  }

  if (state.jobId) {
    const last = await opts.getJob(state.jobId).catch(() => undefined);
    if (last && (last.status === 'running' || last.status === 'queued')) {
      if (last.processed > (state.lastProcessed ?? -1)) {
        // No TTL, as the drainer's state: the key is rewritten every tick.
        await opts.redis.set(
          key,
          JSON.stringify({ jobId: state.jobId, lastProcessed: last.processed }),
        );
        return { started: false, jobId: state.jobId };
      }
      opts.logger.warn(
        `[catch-up] ${opts.family} job ${state.jobId} reports ${last.status} ` +
          `but has not advanced past ${last.processed} since the last tick — ` +
          `treating it as dead and starting a fresh run.`,
      );
    }
  }

  const job = await opts.start();
  await opts.redis.set(key, JSON.stringify({ jobId: job.jobId }));
  return { started: true, jobId: job.jobId };
}
