import { Injectable } from '@nestjs/common';
import { BaseEventProcessor } from 'src/ai/processors/base-processor.interface';
import { RoleplayDirectorEventType } from '../enum/director-event-type.enum';
import {
  DirectorSqsMessage,
  DirectorTelemetryService,
} from '../service/director-telemetry.service';

/**
 * Persists `director_state_transition` messages — the director moved the
 * actor to a new emotional state ({turn_index, from_state_id, to_state_id,
 * guard_id, observed_behavior, rationale}). Registered dynamically via
 * ProcessorRegistry.registerCustomProcessor (no edits under src/ai/).
 */
@Injectable()
export class DirectorStateTransitionProcessor extends BaseEventProcessor {
  constructor(private readonly telemetry: DirectorTelemetryService) {
    super();
  }

  getEventType(): string {
    return RoleplayDirectorEventType.STATE_TRANSITION;
  }

  async process(data: DirectorSqsMessage): Promise<void> {
    await this.telemetry.recordEvent(
      RoleplayDirectorEventType.STATE_TRANSITION,
      data,
    );
  }
}
