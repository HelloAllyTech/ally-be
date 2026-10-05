import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { LanguageJudgeService } from './language-judge.service';
import { LoggerService } from '../../logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';
import { LANGUAGE_CATCHUP_WINDOW_DAYS } from '../constants/judge-scheduling.constants';
import { startCatchupUnlessRunning } from '../util/catchup-job-guard.util';

/**
 * Registers the ongoing language-judge catch-up on the shared 30-minute
 * scheduler (sibling of the drift catch-up; see that service for rationale).
 *
 * Each tick enqueues a language backfill over the last day's sessions that are
 * NOT already judged (`onlyUnjudged=true`) — cheap and idempotent, so newly
 * completed sessions get evaluated and both read surfaces (session logs +
 * analytics) stay current without touching the session-end hot path.
 *
 * It owns the last LANGUAGE_CATCHUP_WINDOW_DAYS outright: the backlog drainer
 * stays out of that window, so the two never judge the same new session.
 * "Unjudged" stays version-agnostic here on purpose. ally-ai stamps whatever
 * version it is running (v2 today, the drainer's target too), so a fresh
 * session is never re-judged by design — and a version-agnostic check cannot
 * loop if ally-ai's version ever moves ahead of the drainer's target.
 *
 * A tick does nothing while the previous run is still working, and the attempt
 * ledger keeps a session that keeps failing from being retried every tick.
 */
@Injectable()
export class LanguageBackfillSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    LanguageBackfillSchedulerRegistrationService.name,
  );

  constructor(
    private readonly languageJudge: LanguageJudgeService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register(
      '30min',
      'language-judge-catchup',
      async () => {
        const run = await startCatchupUnlessRunning({
          family: 'language',
          redis: this.redis,
          logger: this.logger,
          getJob: (jobId) => this.languageJudge.getJob(jobId),
          start: () =>
            this.languageJudge.startBackfill(
              LANGUAGE_CATCHUP_WINDOW_DAYS,
              true, // onlyUnjudged — judge only new sessions, never re-spend
              undefined,
              undefined,
              undefined,
              { honourAttemptLedger: true },
            ),
        });
        this.logger.debug(
          run.started
            ? `language-judge catch-up enqueued: job=${run.jobId}`
            : `language-judge catch-up skipped: job=${run.jobId} still running`,
        );
      },
    );
  }
}
