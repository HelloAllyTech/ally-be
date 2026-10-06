import { Injectable, OnModuleInit } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { HelplineQaService } from './helpline-qa.service';
import { HelplineRetentionService } from './helpline-retention.service';

@Injectable()
export class HelplineSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    HelplineSchedulerRegistrationService.name,
  );

  constructor(
    private readonly retentionService: HelplineRetentionService,
    private readonly qaService: HelplineQaService,
  ) {}

  onModuleInit(): void {
    // Hourly, like the WhatsApp sweep: a coarser interval leaves content past
    // its window for that long. The scheduler takes a Postgres advisory lock
    // per interval, and blanking is idempotent, so a double run is a no-op.
    scheduledTaskRegistry.register('hourly', 'helpline-retention-sweep', () =>
      this.retentionService.runRetentionSweep(),
    );
    // Helping-skills QA of ended chats (contract §10), on the shared 30-minute
    // bucket like the foundational-skills measure. HELPLINE_QA_SCHEDULE=off
    // stops it (read on every tick, no redeploy needed once env reloads).
    scheduledTaskRegistry.register('30min', 'helpline-qa', async () => {
      if (!HelplineQaService.enabled()) return;
      try {
        await this.qaService.tick();
      } catch (error) {
        this.logger.error(
          `helpline-qa tick failed: ${(error as Error)?.message ?? error}`,
        );
      }
    });
  }
}
