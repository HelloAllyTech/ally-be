import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { SessionEvents } from '../entity/session-events.entity';
import { SessionEventTranslationsRepository } from '../repository/session-event-translation.repository';
import { SessionEventRepository } from '../repository/session-event.repository';
import { In } from 'typeorm';

@Injectable()
export class SessionEventSharedService {
  private readonly logger = LoggerService.getInstance(
    SessionEventSharedService.name,
  );

  constructor(
    private readonly sessionEventTranslationsRepository: SessionEventTranslationsRepository,
    private readonly sessionEventRepository: SessionEventRepository,
  ) {}

  async getSessionEventsTranslationsByScenarioId(
    scenarioId: number,
    languageId: number,
  ): Promise<SessionEvents[]> {
    const events =
      await this.sessionEventTranslationsRepository.getSessionEventTranslationsByForMetaData(
        scenarioId,
        languageId,
      );

    return events
      .filter((event) => !event.autoTerminationStatus) // Filter out auto termination events to get correct feedback messages
      .map((event) => ({
        id: event.sessionEvents_id,
        name: event.sessionEvents_name,
        description: event.sessionEvents_description,
        score: event.scenarioEvents_score ?? event.sessionEvents_score,
        emoji:
          (event.scenarioEvents_feedbackStatus ?? true)
            ? event.scenarioEvents_emoji
            : event.sessionEvents_emoji,
        message:
          (event.scenarioEvents_feedbackStatus ?? true)
            ? event.scenarioEvents_message
            : event.sessionEvents_message,
        branchInstruction:
          (event.scenarioEvents_branchingStatus ?? true)
            ? (event.scenarioEvents_branchInstruction ??
              event.sessionEvents_branchInstruction)
            : null,
        detectionType: event.sessionEvents_detectionType,
        data: event.sessionEvents_detectionData,
        visibilityType: event.sessionEvents_visibilityType,
        feedbackStatus: event.scenarioEvents_feedbackStatus,
        speaker: event.sessionEvents_speaker,
        createdAt: event.sessionEvents_createdAt,
        updatedAt: event.sessionEvents_updatedAt,
        eventCode: event.sessionEvents_eventCode,
        detectionConfig: event.scenarioEvents_detectionConfig,
        checklistVisibilityStatus:
          event.scenarioEvents_checklistVisibilityStatus,
      }));
  }

  async getSessionEventsByScenarioId(
    scenarioId: number,
  ): Promise<SessionEvents[]> {
    const events =
      await this.sessionEventRepository.getSessionEventsByScenarioId(
        scenarioId,
      );

    return events.map((event) => ({
      id: event.sessionEvents_id,
      name: event.sessionEvents_name,
      description: event.sessionEvents_description,
      score: event.scenarioEvents_score ?? event.sessionEvents_score,
      emoji:
        (event.scenarioEvents_feedbackStatus ?? true)
          ? event.scenarioEvents_emoji
          : event.sessionEvents_emoji,
      message:
        (event.scenarioEvents_feedbackStatus ?? true)
          ? event.scenarioEvents_message
          : event.sessionEvents_message,
      branchInstruction:
        (event.scenarioEvents_branchingStatus ?? true)
          ? (event.scenarioEvents_branchInstruction ??
            event.sessionEvents_branchInstruction)
          : null,
      detectionType: event.sessionEvents_detectionType,
      data: event.sessionEvents_detectionData,
      visibilityType: event.sessionEvents_visibilityType,
      feedbackStatus: event.scenarioEvents_feedbackStatus,
      speaker: event.sessionEvents_speaker,
      createdAt: event.sessionEvents_createdAt,
      updatedAt: event.sessionEvents_updatedAt,
      eventCode: event.sessionEvents_eventCode,
      checklistVisibilityStatus: event.scenarioEvents_checklistVisibilityStatus,
      detectionConfig: event.scenarioEvents_detectionConfig,
    }));
  }

  async findByIds(ids: string[]): Promise<SessionEvents[]> {
    if (!ids || ids.length === 0) {
      return [];
    }

    return this.sessionEventRepository.find({
      where: { id: In(ids) },
    });
  }

  async findSessionEventById(id: string): Promise<SessionEvents | null> {
    return this.sessionEventRepository.findOne({ where: { id } });
  }
}
