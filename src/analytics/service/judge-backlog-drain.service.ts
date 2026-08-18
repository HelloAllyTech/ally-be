import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { LoggerService } from '../../logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';
import { PlatformAnalyticsService } from './platform-analytics.service';
import { FeedbackGroundednessJudgeService } from './feedback-groundedness-judge.service';
import { DriftJudgeRepository } from '../repository/drift-judge.repository';
import { FeedbackGroundednessRepository } from '../repository/feedback-groundedness.repository';

/**
 * Drains the judge backlog on its own, so backfilling stops being something a
 * person has to remember, stay logged in for, and re-issue after every deploy.
 *
 * The existing catch-ups keep NEW sessions judged (1-day window, onlyUnjudged).
 * This is the other half: the historical backlog left by a rubric change or a
 * newly added judge, which until now was a manual API call holding a token that
 * expires every fifteen minutes — and which any deploy killed halfway through.
 *
 * SHAPE: "ensure a run is in flight until the backlog is empty", not "start a
 * backfill every tick". A tick that finds a job already running does nothing.
 * That matters because the jobs are long — hours — and stacking a new one every
 * thirty minutes would multiply concurrent judge calls against a service that
 * has already been taken down once by exactly that.
 *
 * It stops on its own. Each family's selector excludes sessions already judged
 * under the target version, so when the backlog empties the tick finds nothing
 * eligible and starts nothing. No end date to set, and no cleanup to remember.
 */
const BACKLOG_WINDOW_DAYS = 30;

/**
 * The judge versions the backlog is measured against. These are the values a
 * human would otherwise be typing into the API call, and they are the reason a
 * run can be resumed safely: "already judged" means judged under THIS pair.
 */
const DRIFT_TARGET = { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v2' };
const DRIFT_SOURCE = { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v1' };
const GROUNDEDNESS_TARGET = {
  judgeModel: 'gemini-2.5-pro',
  judgePromptVersion: 'v1',
};

/**
 * Consecutive unproductive runs before this stops trying.
 *
 * A drainer that restarts a failing job forever is a way to spend money on
 * nothing: a 426-session run once failed 426 times inside 25 seconds because an
 * import was missing, and the backlog it was "draining" never shrank. Three
 * strikes, then it holds and says so — a human can clear the breaker by fixing
 * the cause and restarting the service, which is the point at which someone is
 * looking anyway.
 */
const MAX_UNPRODUCTIVE_RUNS = 3;

@Injectable()
export class JudgeBacklogDrainService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    JudgeBacklogDrainService.name,
  );

  constructor(
    private readonly analytics: PlatformAnalyticsService,
    private readonly groundedness: FeedbackGroundednessJudgeService,
    private readonly driftRepo: DriftJudgeRepository,
    private readonly groundednessRepo: FeedbackGroundednessRepository,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('30min', 'judge-backlog-drain', async () => {
      await this.drainDrift();
      await this.drainGroundedness();
    });
  }

  private stateKey(family: string): string {
    return `judge:backlog:${family}`;
  }

  private async readState(
    family: string,
  ): Promise<{ jobId?: string; unproductive: number }> {
    const raw = await this.redis.get(this.stateKey(family));
    if (!raw) return { unproductive: 0 };
    try {
      return JSON.parse(raw) as { jobId?: string; unproductive: number };
    } catch {
      return { unproductive: 0 };
    }
  }

  private async writeState(
    family: string,
    state: { jobId?: string; unproductive: number },
  ): Promise<void> {
    // No TTL: the breaker count has to outlive a job's own hour-long TTL, or a
    // failing family would reset itself to zero strikes and loop forever.
    await this.redis.set(this.stateKey(family), JSON.stringify(state));
  }

  /**
   * Decide whether to start another run for a family.
   *
   * Returns the updated state rather than acting, so the two families share one
   * set of rules and the decision is testable without a judge behind it.
   */
  private async shouldStart(
    family: string,
    lastJob: { status: string; judged: number; failed: number } | undefined,
    state: { jobId?: string; unproductive: number },
  ): Promise<{
    start: boolean;
    next: { jobId?: string; unproductive: number };
  }> {
    if (
      lastJob &&
      (lastJob.status === 'running' || lastJob.status === 'queued')
    ) {
      // Still working. Long runs are normal here; a second job would just
      // contend for the same judge slots.
      return { start: false, next: state };
    }

    if (state.unproductive >= MAX_UNPRODUCTIVE_RUNS) {
      this.logger.error(
        `[backlog] ${family} halted after ${state.unproductive} unproductive ` +
          `runs — judged nothing while failing. Fix the cause and restart the ` +
          `service to clear this.`,
      );
      return { start: false, next: state };
    }

    // A finished run that judged nothing while failing is the signature of a
    // broken judge, not an empty backlog — count it against the breaker.
    const unproductive =
      lastJob && lastJob.judged === 0 && lastJob.failed > 0
        ? state.unproductive + 1
        : 0;

    return { start: true, next: { ...state, unproductive } };
  }

  private async drainDrift(): Promise<void> {
    const state = await this.readState('drift');
    const lastJob = state.jobId
      ? await this.analytics
          .getDriftBackfillStatus(state.jobId)
          .catch(() => undefined)
      : undefined;

    const { start, next } = await this.shouldStart('drift', lastJob, state);
    if (!start) {
      await this.writeState('drift', next);
      return;
    }

    // Anything left to do? Ask for ONE eligible session rather than counting the
    // backlog: this runs every thirty minutes forever, and the answer only ever
    // decides start-or-not.
    const eligible = await this.driftRepo.selectSessions({
      sinceDays: BACKLOG_WINDOW_DAYS,
      onlyUnjudged: true,
      unjudgedForVersion: DRIFT_TARGET,
      judgedForVersion: DRIFT_SOURCE,
      limit: 1,
    });
    if (eligible.length === 0) {
      await this.writeState('drift', { unproductive: 0 });
      return;
    }

    const job = await this.analytics.startDriftBackfill(
      BACKLOG_WINDOW_DAYS,
      true,
      DRIFT_TARGET,
      undefined,
      DRIFT_SOURCE,
    );
    await this.writeState('drift', {
      jobId: job.jobId,
      unproductive: next.unproductive,
    });
    this.logger.debug(
      `[backlog] drift lean top-up started job=${job.jobId} ` +
        `strikes=${next.unproductive}`,
    );
  }

  private async drainGroundedness(): Promise<void> {
    const state = await this.readState('groundedness');
    const lastJob = state.jobId
      ? await this.groundedness.getJob(state.jobId).catch(() => undefined)
      : undefined;

    const { start, next } = await this.shouldStart(
      'groundedness',
      lastJob,
      state,
    );
    if (!start) {
      await this.writeState('groundedness', next);
      return;
    }

    const eligible = await this.groundednessRepo.selectSessions({
      sinceDays: BACKLOG_WINDOW_DAYS,
      unjudgedForVersion: GROUNDEDNESS_TARGET,
      limit: 1,
    });
    if (eligible.length === 0) {
      await this.writeState('groundedness', { unproductive: 0 });
      return;
    }

    const job = await this.groundedness.startBackfill(
      BACKLOG_WINDOW_DAYS,
      GROUNDEDNESS_TARGET,
    );
    await this.writeState('groundedness', {
      jobId: job.jobId,
      unproductive: next.unproductive,
    });
    this.logger.debug(
      `[backlog] groundedness started job=${job.jobId} strikes=${next.unproductive}`,
    );
  }
}
