import { Injectable } from '@nestjs/common';
import { BaseEventProcessor } from 'src/ai/processors/base-processor.interface';
import { RoleplayDirectorEventType } from '../enum/director-event-type.enum';
import {
  DirectorSqsMessage,
  DirectorTelemetryService,
} from '../service/director-telemetry.service';

/**
 * Persists `director_disclosure_unlock` messages ({turn_index, secret_id,
 * unlock_condition_id, disclosed_content_summary}) — the trainee earned a
 * secret from the disclosure ledger.
 */
@Injectable()
export class DirectorDisclosureUnlockProcessor extends BaseEventProcessor {
  constructor(private readonly telemetry: DirectorTelemetryService) {
    super();
  }

  getEventType(): string {
    return RoleplayDirectorEventType.DISCLOSURE_UNLOCK;
  }

  async process(data: DirectorSqsMessage): Promise<void> {
    await this.telemetry.recordEvent(
      RoleplayDirectorEventType.DISCLOSURE_UNLOCK,
      data,
    );
  }
}
