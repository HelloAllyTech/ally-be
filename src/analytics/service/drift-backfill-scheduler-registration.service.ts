import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { PlatformAnalyticsService } from './platform-analytics.service';
import { LoggerService } from '../../logger/logger.service';

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
 */
const DRIFT_CATCHUP_WINDOW_DAYS = 1;

@Injectable()
export class DriftBackfillSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    DriftBackfillSchedulerRegistrationService.name,
  );

  constructor(private readonly analytics: PlatformAnalyticsService) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('30min', 'drift-catchup', async () => {
      const job = await this.analytics.startDriftBackfill(
        DRIFT_CATCHUP_WINDOW_DAYS,
        true, // onlyUnjudged — judge only new sessions, never re-spend
      );
      this.logger.debug(`drift catch-up enqueued: job=${job.jobId}`);
    });
  }
}
