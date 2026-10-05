import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { PlatformAnalyticsService } from './platform-analytics.service';
import { LoggerService } from '../../logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';
import { DRIFT_CATCHUP_WINDOW_DAYS } from '../constants/judge-scheduling.constants';
import { startCatchupUnlessRunning } from '../util/catchup-job-guard.util';

/**
 * Registers the ongoing drift catch-up on the shared 30-minute scheduler.
 *
 * Each tick enqueues a drift backfill over the last day's sessions that are
 * NOT already judged (`onlyUnjudged=true`) — cheap and idempotent, so newly
 * completed sessions get evaluated and the dashboard stays current without
 * touching the session-end hot path. A 1-day window (vs 30 min) gives generous
 * overlap so nothing is missed if a tick is skipped or a session lands late.
 *
 * The manual "Re-run" button is the other entry point (full re-judge for prompt
 * iteration); this is the automatic accumulation path.
 *
 * It cannot collide with the backlog drainer's drift family, unlike language:
 * this judges sessions with NO drift rows, the drainer only tops up sessions
 * that already carry v1 rows, and ally-ai writes new sessions straight at v2.
 * A tick does nothing while the previous run is still working, and the
 * attempt ledger keeps a session that keeps failing from being retried every
 * tick.
 */
@Injectable()
export class DriftBackfillSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    DriftBackfillSchedulerRegistrationService.name,
  );

  constructor(
    private readonly analytics: PlatformAnalyticsService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('30min', 'drift-catchup', async () => {
      const run = await startCatchupUnlessRunning({
        family: 'drift',
        redis: this.redis,
        logger: this.logger,
        getJob: (jobId) => this.analytics.getDriftBackfillStatus(jobId),
        start: () =>
          this.analytics.startDriftBackfill(
            DRIFT_CATCHUP_WINDOW_DAYS,
            true, // onlyUnjudged — judge only new sessions, never re-spend
            undefined,
            undefined,
            undefined,
            undefined,
            { honourAttemptLedger: true },
          ),
      });
      this.logger.debug(
        run.started
          ? `drift catch-up enqueued: job=${run.jobId}`
          : `drift catch-up skipped: job=${run.jobId} still running`,
      );
    });
  }
}
