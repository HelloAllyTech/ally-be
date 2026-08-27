import { Injectable, OnModuleInit } from '@nestjs/common';

import { LoggerService } from 'src/logger/logger.service';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';

import { UxSignalScanTrigger } from '../enum/ux-signal.enum';
import { UxSignalsService } from './ux-signals.service';

/**
 * Registers the UX Signals scan on the shared hourly scheduler.
 *
 * Registered hourly but *gated* to roughly daily inside the handler: the registry
 * offers 5min/15min/30min/hourly/monthly and no daily tick, so the cadence has to
 * live in the task. The gate reads the newest scan row rather than an in-memory
 * marker, so a redeploy does not reset the clock and re-scan immediately.
 *
 * Daily rather than hourly is a product decision, not a cost one. UX trends do not
 * move hour to hour, and both destinations are human review queues — filing into
 * them faster than a person works through them would make the queues useless, which
 * is the failure mode that gets automated pipelines switched off.
 *
 * The tick swallows its errors on purpose. A scheduled scan is best-effort: PostHog
 * is a self-hosted deployment that restarts for its own reasons, and a failure is
 * already recorded on the scan row and surfaced in the admin UI. Throwing here would
 * add nothing a reader can act on and would noise up the shared runner that every
 * other module's tasks share.
 */
@Injectable()
export class UxSignalsSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    UxSignalsSchedulerRegistrationService.name,
  );

  constructor(private readonly uxSignals: UxSignalsService) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('hourly', 'ux-signals-scan', async () => {
      if (!(await this.uxSignals.isDueForScheduledScan())) return;

      try {
        const outcome = await this.uxSignals.runScan(
          UxSignalScanTrigger.SCHEDULED,
        );
        this.logger.info(
          `[UX-SIGNALS] Scheduled scan ${outcome.scanId}: ` +
            `${outcome.signalsDetected} signals, ` +
            `${outcome.findingsCreated} findings, ` +
            `${outcome.suggestionsCreated} suggestions, ` +
            `${outcome.skippedDuplicates} already known.`,
        );
      } catch (error) {
        this.logger.warn(
          `[UX-SIGNALS] Scheduled scan failed: ${String(error)}`,
        );
      }
    });
  }
}
