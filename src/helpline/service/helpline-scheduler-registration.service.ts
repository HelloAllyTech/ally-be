import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { HelplineRetentionService } from './helpline-retention.service';

@Injectable()
export class HelplineSchedulerRegistrationService implements OnModuleInit {
  constructor(private readonly retentionService: HelplineRetentionService) {}

  onModuleInit(): void {
    // Hourly, like the WhatsApp sweep: a coarser interval leaves content past
    // its window for that long. The scheduler takes a Postgres advisory lock
    // per interval, and blanking is idempotent, so a double run is a no-op.
    scheduledTaskRegistry.register('hourly', 'helpline-retention-sweep', () =>
      this.retentionService.runRetentionSweep(),
    );
  }
}
