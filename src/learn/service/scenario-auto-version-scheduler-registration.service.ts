import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { LoggerService } from '../../logger/logger.service';
import { ScenarioVersionService } from './scenario-version.service';

/**
 * Wires the daily auto-version snapshot (see ScenarioVersionService's
 * docblock) into the shared 'daily' scheduler slot.
 */
@Injectable()
export class ScenarioAutoVersionSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    ScenarioAutoVersionSchedulerRegistrationService.name,
  );

  constructor(
    private readonly scenarioVersionService: ScenarioVersionService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('daily', 'scenario-auto-version-daily', () =>
      this.runDailyAutoVersion(),
    );
  }

  async runDailyAutoVersion(): Promise<void> {
    const created =
      await this.scenarioVersionService.createDailyAutomaticVersions();
    this.logger.debug(`Created ${created} automatic scenario version(s)`);
  }
}
