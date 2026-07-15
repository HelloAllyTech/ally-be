import { Injectable } from '@nestjs/common';
import { BaseEventProcessor } from 'src/ai/processors/base-processor.interface';
import { RoleplayDirectorEventType } from '../enum/director-event-type.enum';
import {
  DirectorSqsMessage,
  DirectorTelemetryService,
} from '../service/director-telemetry.service';

/**
 * Persists `director_rubric_score` messages ({turn_index, scores:
 * [{behavior_id, score, rationale}]}): the raw event row plus one flattened
 * roleplay_rubric_scores row per behavior for cheap aggregation.
 */
@Injectable()
export class DirectorRubricScoreProcessor extends BaseEventProcessor {
  constructor(private readonly telemetry: DirectorTelemetryService) {
    super();
  }

  getEventType(): string {
    return RoleplayDirectorEventType.RUBRIC_SCORE;
  }

  async process(data: DirectorSqsMessage): Promise<void> {
    const session = await this.telemetry.resolveSession(data.room_id);
    if (!session) {
      this.logInfo(
        `No scenario session for rubric scores in room ${data.room_id}; skipping`,
      );
      return;
    }
    await this.telemetry.recordEvent(
      RoleplayDirectorEventType.RUBRIC_SCORE,
      data,
    );
    await this.telemetry.recordRubricScores(session, data);
  }
}
