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
 * SHAPE: each tick takes on a BOUNDED CHUNK of the backlog and finishes inside
 * the tick. Runs used to swallow the whole backlog — hours — which made every
 * deploy expensive: the process died mid-run, the job record still said
 * "running", and the service had to infer the death across two ticks before it
 * could start again. Chunking removes the question rather than answering it
 * faster. An interrupted chunk costs only the sessions in flight, because the
 * selectors already exclude everything judged, and the next tick simply asks
 * for the next chunk.
 *
 * A tick that still finds a run in flight does nothing, so an overrunning chunk
 * cannot stack concurrent judge calls against a service that has already been
 * taken down once by exactly that.
 *
 * It stops on its own. Each family's selector excludes sessions already judged
 * under the target version, so when the backlog empties the tick finds nothing
 * eligible and starts nothing. No end date to set, and no cleanup to remember.
 */
/**
 * How far back the drainer will reach.
 *
 * Was 30 days, which quietly decided what the dashboard could be asked. Tamil
 * runs entirely on gpt-4.1-mini and every other language on gpt-4o-mini, so
 * "Tamil is worse" and "4.1-mini is worse" were the same population and could
 * not be told apart. The only sessions that break that tie are the same Tamil
 * cohort's April-May runs, from before the model was pinned — 30 days put them
 * out of reach.
 *
 * 150 days covers the platform's first non-English traffic. Raising it is
 * self-limiting rather than open-ended: every selector skips sessions already
 * judged under the target version, so the window only decides how much history
 * is eligible ONCE. When the backlog empties the tick finds nothing and starts
 * nothing, and it stays that way.
 *
 * Note what this does NOT reach. The drift family runs as a lean top-up that
 * copies an existing v1 row forward, so it can only extend to sessions that
 * already carry v1 drift labels — roughly July onward. Older sessions need a
 * full drift judge, which is a separate pass, not a wider window.
 */
const BACKLOG_WINDOW_DAYS = 150;

/**
 * How many sessions one tick takes on, per family.
 *
 * This is what makes the drainer survive a restart, and it replaces detection
 * with arithmetic. A run used to take the WHOLE backlog — hours — so a deploy
 * killed it mid-flight and the service then had to work out that a job
 * reporting "running" was held by a process that no longer existed. That took
 * two ticks, so a restart cost up to an hour of progress. Three deploys in one
 * morning cost roughly three hours.
 *
 * Sized so a tick's work lands just inside the tick. Three families share one
 * global ceiling of three concurrent judge calls at roughly a minute each, so
 * the platform clears about ninety sessions per half hour however the work is
 * divided — 25 per family fills the tick without overrunning it.
 *
 * A chunk that dies costs only the sessions in flight, because the selectors
 * already exclude everything judged: the next tick just asks for the next 25.
 * Nothing has to notice the death for that to work.
 */
const BACKLOG_CHUNK = 25;

/**
 * Round-trip WER is topped up in bigger chunks because it does not compete for
 * the judge ceiling — it is a speech-vendor round trip, bounded separately.
 */
const ROUND_TRIP_CHUNK = 40;

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
      await this.drainRoundTripWer();
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
      BACKLOG_CHUNK,
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
      undefined,
      BACKLOG_CHUNK,
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
      undefined,
      BACKLOG_CHUNK,
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

  /**
   * Fill in round-trip WER for judgments that were written without it.
   *
   * Kept out of the judging loop and given its own step because it is the only
   * measurement here that talks to a speech vendor: a TTS call plus an ASR call
   * per sampled utterance. Inline, a timeout held a judging worker for three
   * minutes on 37% of sessions — throughput spent on a field that renders as
   * "not measured" either way.
   *
   * No job record and no staleness handling, because it needs none: the
   * selector only ever returns rows that are still NULL, so an interrupted run
   * is simply a shorter one and the next tick asks again.
   */
  private async drainRoundTripWer(): Promise<void> {
    try {
      const { attempted, measured } = await this.language.topUpRoundTripWer(
        LANGUAGE_TARGET,
        ROUND_TRIP_CHUNK,
      );
      if (attempted > 0) {
        this.logger.debug(
          `[backlog] round-trip WER topped up ${measured}/${attempted}`,
        );
      }
    } catch (e) {
      // Never let a speech-vendor problem stop the judging families that ran
      // before it on this tick.
      this.logger.warn(
        `[backlog] round-trip WER top-up failed: ${(e as Error).message}`,
      );
    }
  }
}
