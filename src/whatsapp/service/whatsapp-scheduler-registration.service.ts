import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { WhatsAppRetentionService } from './whatsapp-retention.service';

@Injectable()
export class WhatsAppSchedulerRegistrationService implements OnModuleInit {
  constructor(private readonly retentionService: WhatsAppRetentionService) {}

  onModuleInit(): void {
    // Hourly, not daily. The runner's only long interval is monthly, and a monthly retention sweep
    // means data sits up to a month past its window — which defeats the point of having one. The
    // sweep is cheap when there is nothing past the cutoff: it counts first and returns, so 23 of
    // every 24 runs do a single indexed COUNT and stop.
    //
    // The runner takes a Postgres advisory lock per interval, so this cannot double-run across
    // replicas; and blanking is idempotent, so even if it did, the second pass would be a no-op.
    scheduledTaskRegistry.register('hourly', 'whatsapp-retention-sweep', () =>
      this.retentionService.runRetentionSweep(),
    );
  }
}
