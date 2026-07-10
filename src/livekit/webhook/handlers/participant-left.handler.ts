import { Injectable } from '@nestjs/common';
import { ParticipantInfo_Kind } from '@livekit/protocol';
import { ScenarioSessionService } from 'src/learn/service/scenario-session.service';
import { ScenarioSessionLifecycleEventType } from 'src/learn/entity/scenario-session-lifecycle-event.entity';
import { LoggerService } from 'src/logger/logger.service';

export interface ParticipantLeftEvent {
  event: 'participant_left';
  room: {
    name: string;
    sid: string;
  };
  participant: {
    sid: string;
    identity: string;
    kind: number;
  };
  id: string;
  created_at: number;
}

/**
 * Records AGENT_LEFT when the AI agent participant leaves a room. Paired with
 * AGENT_JOINED this reveals mid-session drops (e.g. an OOM-recycled worker task
 * disconnecting mid-call) — a failure class that is otherwise invisible because
 * the session still looks like it had an agent. Human participants leaving are
 * ignored here (the normal end is covered by room_finished).
 */
@Injectable()
export class ParticipantLeftHandler {
  private readonly logger = new LoggerService(ParticipantLeftHandler.name);

  constructor(
    private readonly scenarioSessionService: ScenarioSessionService,
  ) {}

  async handle(event: ParticipantLeftEvent): Promise<void> {
    const roomName = event.room?.name;
    if (!roomName || event.participant?.kind !== ParticipantInfo_Kind.AGENT) {
      return;
    }

    const sessionId =
      this.scenarioSessionService.sessionIdFromRoomName(roomName);
    if (!sessionId) return;

    this.logger.info(
      `Agent left room ${roomName} (identity: ${event.participant.identity})`,
    );
    void this.scenarioSessionService.recordLifecycleEvent(
      sessionId,
      ScenarioSessionLifecycleEventType.AGENT_LEFT,
      new Date(),
      { identity: event.participant.identity },
    );
  }
}
