import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioSessions } from 'src/learn/entity/scenario-sessions.entity';
import { RoleplayDirectorEvent } from '../entity/roleplay-director-event.entity';
import { RoleplayRubricScore } from '../entity/roleplay-rubric-score.entity';
import { RoleplayDirectorEventType } from '../enum/director-event-type.enum';
import { RoleplayDirectorEventRepository } from '../repository/roleplay-director-event.repository';
import { RoleplayRubricScoreRepository } from '../repository/roleplay-rubric-score.repository';

/** Envelope shared by every director message on the learn SQS queue. */
export interface DirectorSqsMessage {
  message_type: string;
  timestamp?: number;
  room_id: string;
  data: Record<string, any>;
}

/**
 * Shared persistence for the director SQS processors: resolve the session by
 * room_id (skip unknown rooms without throwing — the queue is shared and
 * multi-env), write the raw event row, and flatten rubric scores.
 */
@Injectable()
export class DirectorTelemetryService {
  private readonly logger = LoggerService.getInstance(
    DirectorTelemetryService.name,
  );

  constructor(
    private readonly directorEventRepository: RoleplayDirectorEventRepository,
    private readonly rubricScoreRepository: RoleplayRubricScoreRepository,
    private readonly dataSource: DataSource,
  ) {}

  async resolveSession(roomId: string): Promise<ScenarioSessions | null> {
    if (!roomId) return null;
    return this.dataSource
      .getRepository(ScenarioSessions)
      .findOne({ where: { roomId } });
  }

  toOccurredAt(timestamp?: number): Date | null {
    return timestamp ? new Date(timestamp * 1000) : null;
  }

  /**
   * Persist one director event. Returns null (after a warn) when the room
   * doesn't resolve to a session — the message is consumed, never retried.
   */
  async recordEvent(
    eventType: RoleplayDirectorEventType,
    message: DirectorSqsMessage,
  ): Promise<RoleplayDirectorEvent | null> {
    const session = await this.resolveSession(message.room_id);
    if (!session) {
      this.logger.warn(
        `No scenario session for roleplay director event ${eventType} in room ${message.room_id}; skipping`,
      );
      return null;
    }
    return this.directorEventRepository.save(
      this.directorEventRepository.create({
        scenarioSessionId: session.id,
        roomId: message.room_id,
        eventType,
        turnIndex:
          typeof message.data?.turn_index === 'number'
            ? message.data.turn_index
            : null,
        payload: message.data ?? {},
        occurredAt: this.toOccurredAt(message.timestamp),
      }),
    );
  }

  /** Flatten a director_rubric_score payload into roleplay_rubric_scores. */
  async recordRubricScores(
    session: ScenarioSessions,
    message: DirectorSqsMessage,
  ): Promise<RoleplayRubricScore[]> {
    const scores: any[] = Array.isArray(message.data?.scores)
      ? message.data.scores
      : [];
    if (scores.length === 0) return [];
    const rows = scores
      .filter((score) => score && score.behavior_id !== undefined)
      .map((score) =>
        this.rubricScoreRepository.create({
          scenarioSessionId: session.id,
          roomId: message.room_id,
          turnIndex: Number(message.data?.turn_index ?? 0),
          behaviorId: String(score.behavior_id),
          score: Number(score.score ?? 0),
          rationale: score.rationale ?? null,
          occurredAt: this.toOccurredAt(message.timestamp),
        }),
      );
    return this.rubricScoreRepository.save(rows);
  }
}
