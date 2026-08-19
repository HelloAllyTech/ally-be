import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { LoggerService } from '../../logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';
import { PlatformAnalyticsService } from './platform-analytics.service';
import { FeedbackGroundednessJudgeService } from './feedback-groundedness-judge.service';
import { LanguageJudgeService } from './language-judge.service';
import { DriftJudgeRepository } from '../repository/drift-judge.repository';
import { FeedbackGroundednessRepository } from '../repository/feedback-groundedness.repository';
import { LanguageJudgeRepository } from '../repository/language-judge.repository';

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
 * Language is a FULL re-judge, not a lean top-up, and that is not an oversight.
 *
 * The language judge writes a session row plus a set of annotations, and
 * re-judging DELETEs and re-INSERTs that set — error sets can shrink, so an
 * upsert would strand rows that the new rubric no longer finds. There is no
 * per-turn row to top up the way drift has, so obtaining the widened
 * dialect_lexicon means re-emitting every dimension.
 *
 * It is also why this matters more than it looks: the live catch-up judges NEW
 * sessions under v2 continuously, so the dashboard pins language to v2 and
 * shows the handful of sessions judged since that deploy — 1,776 annotations of
 * real history sit under v1, invisible, until the backlog is re-judged into v2.
 */
const LANGUAGE_TARGET = {
  judgeModel: 'gemini-2.5-pro',
  judgePromptVersion: 'v2',
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
    private readonly language: LanguageJudgeService,
    private readonly driftRepo: DriftJudgeRepository,
    private readonly groundednessRepo: FeedbackGroundednessRepository,
    private readonly languageRepo: LanguageJudgeRepository,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('30min', 'judge-backlog-drain', async () => {
      await this.drainDrift();
      await this.drainGroundedness();
      await this.drainLanguage();
    });
  }

  private stateKey(family: string): string {
    return `judge:backlog:${family}`;
  }

  private async readState(family: string): Promise<{
    jobId?: string;
    unproductive: number;
    lastProcessed?: number;
  }> {
    const raw = await this.redis.get(this.stateKey(family));
    if (!raw) return { unproductive: 0 };
    try {
      return JSON.parse(raw) as {
        jobId?: string;
        unproductive: number;
        lastProcessed?: number;
      };
    } catch {
      return { unproductive: 0 };
    }
  }

  private async writeState(
    family: string,
    state: { jobId?: string; unproductive: number; lastProcessed?: number },
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
    lastJob:
      | { status: string; judged: number; failed: number; processed: number }
      | undefined,
    state: { jobId?: string; unproductive: number; lastProcessed?: number },
  ): Promise<{
    start: boolean;
    next: { jobId?: string; unproductive: number; lastProcessed?: number };
  }> {
    if (
      lastJob &&
      (lastJob.status === 'running' || lastJob.status === 'queued')
    ) {
      // "running" is not proof of life. A deploy kills the process holding the
      // loop WITHOUT updating the record, so a dead job reads as running until
      // its own TTL expires an hour later — which is exactly the case this
      // service exists to cover, and it silently did nothing about it.
      //
      // Progress is the real signal: a live job advances `processed` well
      // inside a tick (a judge call is ~60s median), so a run that has not
      // moved since the previous tick is held by a process that is gone.
      const advanced = lastJob.processed > (state.lastProcessed ?? -1);
      if (advanced) {
        return {
          start: false,
          next: { ...state, lastProcessed: lastJob.processed },
        };
      }
      this.logger.warn(
        `[backlog] ${family} job ${state.jobId} reports running but has not ` +
          `advanced past ${lastJob.processed} since the last tick — treating ` +
          `it as dead and starting a fresh run.`,
      );
      // Fall through and start again. Restarting is safe: the selectors skip
      // everything already judged, so a run that was in fact alive would only
      // repeat work it had not yet reached.
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
      lastProcessed: undefined,
    });
    this.logger.debug(
      `[backlog] drift lean top-up started job=${job.jobId} ` +
        `strikes=${next.unproductive}`,
    );
  }

  private async drainLanguage(): Promise<void> {
    const state = await this.readState('language');
    const lastJob = state.jobId
      ? await this.language.getJob(state.jobId).catch(() => undefined)
      : undefined;

    const { start, next } = await this.shouldStart('language', lastJob, state);
    if (!start) {
      await this.writeState('language', next);
      return;
    }

    const eligible = await this.languageRepo.selectSessions({
      sinceDays: BACKLOG_WINDOW_DAYS,
      onlyUnjudged: true,
      unjudgedForVersion: LANGUAGE_TARGET,
      limit: 1,
    });
    if (eligible.length === 0) {
      await this.writeState('language', { unproductive: 0 });
      return;
    }

    const job = await this.language.startBackfill(
      BACKLOG_WINDOW_DAYS,
      true,
      LANGUAGE_TARGET,
    );
    await this.writeState('language', {
      jobId: job.jobId,
      unproductive: next.unproductive,
      lastProcessed: undefined,
    });
    this.logger.debug(
      `[backlog] language re-judge started job=${job.jobId} strikes=${next.unproductive}`,
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
      lastProcessed: undefined,
    });
    this.logger.debug(
      `[backlog] groundedness started job=${job.jobId} strikes=${next.unproductive}`,
    );
  }
}
