import { Injectable, OnModuleInit } from '@nestjs/common';

import { LoggerService } from 'src/logger/logger.service';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';

import { ProductUpdateDigestService } from './product-update-digest.service';
import { ProductUpdatePipelineService } from './product-update-pipeline.service';

/**
 * Two ticks:
 *
 *  - every 30 minutes, a pipeline pass. Started, not awaited: a pass can
 *    spend minutes on model calls, and the shared runner executes an
 *    interval's tasks one after another, so awaiting it here would delay
 *    every other half-hourly task. The pipeline's own Redis lock keeps passes
 *    from overlapping.
 *  - hourly, the digest — which sends only in its business-timezone hour.
 *
 * Both no-op while `PRODUCT_UPDATES_ENABLED` is off (the digest also while no
 * recipients are configured).
 */
@Injectable()
export class ProductUpdatesSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    ProductUpdatesSchedulerRegistrationService.name,
  );

  constructor(
    private readonly pipeline: ProductUpdatePipelineService,
    private readonly digest: ProductUpdateDigestService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register(
      '30min',
      'product-updates-pipeline',
      async () => {
        if (!this.pipeline.enabled) return;
        void this.pipeline
          .run('scheduled')
          .catch((error) =>
            this.logger.error(
              `[PRODUCT-UPDATES] Scheduled pass crashed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
      },
    );

    scheduledTaskRegistry.register(
      'hourly',
      'product-updates-digest',
      async () => {
        if (!this.pipeline.enabled) return;
        try {
          const outcome = await this.digest.sendIfDue();
          if (outcome === 'sent' || outcome === 'failed') {
            this.logger.info(`[PRODUCT-UPDATES] Digest: ${outcome}.`);
          }
        } catch (error) {
          this.logger.error(
            `[PRODUCT-UPDATES] Digest tick failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      },
    );
  }
}
