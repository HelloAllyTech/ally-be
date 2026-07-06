import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseEventProcessor } from 'src/ai/processors/base-processor.interface';
import { ScenarioSessions } from 'src/learn/entity/scenario-sessions.entity';
import { RoleplayDirectorEventType } from '../enum/director-event-type.enum';
import {
  DirectorSqsMessage,
  DirectorTelemetryService,
} from '../service/director-telemetry.service';

/**
 * Persists the end-of-session `roleplay_session_summary` message
 * ({final_state_id, state_path, ledger, cumulative_score, behavior_hits}):
 * the raw event row, plus the session's score and a metadata block so the
 * session list can show the outcome without joining telemetry.
 */
@Injectable()
export class RoleplaySessionSummaryProcessor extends BaseEventProcessor {
  constructor(
    private readonly telemetry: DirectorTelemetryService,
    private readonly dataSource: DataSource,
  ) {
    super();
  }

  getEventType(): string {
    return RoleplayDirectorEventType.SESSION_SUMMARY;
  }

  async process(data: DirectorSqsMessage): Promise<void> {
    const session = await this.telemetry.resolveSession(data.room_id);
    if (!session) {
      this.logInfo(
        `No scenario session for roleplay summary in room ${data.room_id}; skipping`,
      );
      return;
    }
    await this.telemetry.recordEvent(
      RoleplayDirectorEventType.SESSION_SUMMARY,
      data,
    );

    const summary = data.data ?? {};
    const update: Partial<ScenarioSessions> = {
      metadata: {
        ...(session.metadata ?? {}),
        roleplaySummary: {
          finalStateId: summary.final_state_id ?? null,
          statePath: summary.state_path ?? null,
          ledger: summary.ledger ?? null,
          cumulativeScore: summary.cumulative_score ?? null,
          behaviorHits: summary.behavior_hits ?? null,
        },
      },
    };
    if (typeof summary.cumulative_score === 'number') {
      update.score = summary.cumulative_score;
    }
    await this.dataSource
      .getRepository(ScenarioSessions)
      .update(session.id, update);
  }
}
