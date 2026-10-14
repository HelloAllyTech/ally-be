import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import {
  COURSE_COPILOT_BOOT_RECONCILE_DELAY_MS,
  COURSE_COPILOT_RECONCILE_INTERVAL,
  COURSE_COPILOT_RECONCILE_TASK,
} from '../constants/course-copilot.constants';
import { CourseCopilotBuildService } from './course-copilot-build.service';

@Injectable()
export class CourseCopilotSchedulerRegistrationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = LoggerService.getInstance(
    CourseCopilotSchedulerRegistrationService.name,
  );
  private bootTimer: NodeJS.Timeout | null = null;

  constructor(private readonly buildService: CourseCopilotBuildService) {}

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
  }

  onModuleInit(): void {
    // The build runs inside an ally-be process, and a deploy replaces those
    // mid-build. This tick is what picks a build back up afterwards: it fails
    // jobs whose heartbeat went quiet and restarts any session with queued
    // work and no runner. It costs one indexed query when nothing is building.
    scheduledTaskRegistry.register(
      COURSE_COPILOT_RECONCILE_INTERVAL,
      COURSE_COPILOT_RECONCILE_TASK,
      () => this.buildService.reconcile(),
    );

    // A deploy is exactly when builds get orphaned, and waiting up to five
    // minutes for the next tick leaves a trainer watching a frozen build.
    // Delayed so boot finishes first; a no-op when nothing is building.
    this.bootTimer = setTimeout(() => {
      this.bootTimer = null;
      this.buildService
        .reconcile()
        .catch((error) =>
          this.logger.warn(
            `Course Copilot boot reconcile failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
    }, COURSE_COPILOT_BOOT_RECONCILE_DELAY_MS);
    this.bootTimer.unref?.();
  }
}
