import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { RoadmapBuilderService } from './roadmap-builder.service';

/**
 * Keeps the board honest about work Builder has finished.
 *
 * An opportunity handed to Builder used to sit at whatever stage it was in
 * while the build ran, merged and deployed — so the roadmap said `new` about
 * something already live in production, and a person had to notice and move it
 * by hand. `openSession` now marks the start; this marks the finish.
 *
 * Every 15 minutes rather than every 5: nothing here is urgent, the answer only
 * changes when a release lands, and the 5-minute slot already carries Builder's
 * own reconcile.
 */
@Injectable()
export class RoadmapBuilderSchedulerRegistrationService implements OnModuleInit {
  constructor(private readonly builderService: RoadmapBuilderService) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register(
      '15min',
      'roadmap-builder-shipped-reconcile',
      () => this.builderService.reconcileShippedOpportunities(),
    );
  }
}
