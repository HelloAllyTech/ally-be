import { Injectable, OnModuleInit } from '@nestjs/common';
import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { ElevenLabsVoiceSyncService } from './elevenlabs-voice-sync.service';

@Injectable()
export class ElevenLabsVoiceSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    ElevenLabsVoiceSchedulerRegistrationService.name,
  );

  constructor(
    private readonly elevenLabsVoiceSyncService: ElevenLabsVoiceSyncService,
  ) {}

  onModuleInit(): void {
    // Monthly, not more often: a voice's category on ElevenLabs almost never
    // changes. Listing the workspace is free either way (unlike a preview
    // call) — this just keeps drift from silently accumulating between
    // manual re-checks, the same way the admin-triggered bulk sync does.
    scheduledTaskRegistry.register(
      'monthly',
      'elevenlabs-voice-type-sync',
      async () => {
        const summary =
          await this.elevenLabsVoiceSyncService.bulkSyncAllVoices();
        this.logger.info(
          `[ELEVENLABS_SYNC] monthly: checked=${summary.checked} updated=${summary.updated} ` +
            `mismatched=${summary.mismatched.length} failed=${summary.failed.length}`,
        );
      },
    );
  }
}
