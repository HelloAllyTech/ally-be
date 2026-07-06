import { Injectable } from '@nestjs/common';
import { BaseEventProcessor } from 'src/ai/processors/base-processor.interface';
import { RoleplayDirectorEventType } from '../enum/director-event-type.enum';
import {
  DirectorSqsMessage,
  DirectorTelemetryService,
} from '../service/director-telemetry.service';

/**
 * Persists `director_stage_direction` messages ({turn_index, direction,
 * kind: 'stage_direction' | 'engineered_event', event_id?}) — what the
 * director whispered to the actor this turn.
 */
@Injectable()
export class DirectorStageDirectionProcessor extends BaseEventProcessor {
  constructor(private readonly telemetry: DirectorTelemetryService) {
    super();
  }

  getEventType(): string {
    return RoleplayDirectorEventType.STAGE_DIRECTION;
  }

  async process(data: DirectorSqsMessage): Promise<void> {
    await this.telemetry.recordEvent(
      RoleplayDirectorEventType.STAGE_DIRECTION,
      data,
    );
  }
}
