import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 } from 'uuid';
import { DataSource, In } from 'typeorm';

import { SessionEvents } from '../entity/session-events.entity';
import { ScenarioEvents } from 'src/learn/entity/scenario-events.entity';
import { Pagination } from 'src/common/type/common.type';
import { SessionEventRepository } from '../repository/session-event.repository';
import { SessionEventVisibilityType } from '../enum/session-event-visibility-type.enum';
import {
  mapDbExpressionToResponse,
  mapRequestToDbExpression,
} from '../util/session-event.util';
import {
  CombinationExpressionDto,
  CombinationExpressionRequestDto,
  CreateSessionEventDto,
  SessionEventResponseDto,
  UpdateSessionEventDto,
} from '../dto/session-event.dto';

@Injectable()
export class SessionEventService {
  constructor(
    private readonly sessionEventRepository: SessionEventRepository,
    private readonly dataSource: DataSource,
  ) {}

  async createSessionEvents(
    createEventDtos: CreateSessionEventDto[],
  ): Promise<SessionEvents[]> {
    const events = createEventDtos.map((event) => {
      const mappedDetectionData = event.detectionData
        ? {
            ...event.detectionData,
            expression: mapRequestToDbExpression(
              event?.detectionData
                ?.expression as CombinationExpressionRequestDto,
            ),
          }
        : undefined;

      return {
        id: v4(),
        ...event,
        detectionData: mappedDetectionData,
      };
    });
    return this.sessionEventRepository.createSessionEvents(
      events as CreateSessionEventDto[],
    );
  }

  async getSessionEventsByScenarioId(
    scenarioId: number,
  ): Promise<SessionEvents[]> {
    const events =
      await this.sessionEventRepository.getSessionEventsByScenarioId(
        scenarioId,
      );

    const sessionEvents = events.map((event) => {
      return {
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
      };
    });
    return sessionEvents;
  }

  // TODO: updateEventDto to not pass directly and select the necessary values only
  // passing something will be saved directly to DB(even if it is not expected but is present in DB)
  async updateSessionEvent(
    id: string,
    updateEventDto: UpdateSessionEventDto,
  ): Promise<boolean> {
    const event = await this.sessionEventRepository.findOne({ where: { id } });
    if (!event) {
      throw new NotFoundException('Session Event not found');
    }
    const mappedDetectionData = updateEventDto.detectionData
      ? {
          ...updateEventDto.detectionData,
          expression: mapRequestToDbExpression(
            updateEventDto?.detectionData
              ?.expression as CombinationExpressionRequestDto,
          ),
        }
      : undefined;

    const formattedEventDto = {
      ...updateEventDto,
      detectionData: mappedDetectionData,
    };
    const updated = await this.sessionEventRepository.update(
      id,
      formattedEventDto as Partial<SessionEvents>,
    );
    return updated.affected !== 0;
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

  async getAllSessionEvents(
    visibilityType?: SessionEventVisibilityType,
    searchName?: string,
    pagination?: Pagination,
  ): Promise<{ data: SessionEventResponseDto[] }> {
    const sessionEvents = await this.sessionEventRepository.getAllSessionEvents(
      visibilityType,
      searchName,
      pagination,
    );

    const formattedSessionEvents = sessionEvents.map((event) => {
      return {
        ...event,
        detectionData: event?.detectionData
          ? {
              ...event.detectionData,
              expression: mapDbExpressionToResponse(
                event?.detectionData?.expression as CombinationExpressionDto,
              ),
            }
          : undefined,
      };
    });
    return { data: formattedSessionEvents };
  }

  async deleteSessionEvents(eventIds: string[]): Promise<boolean> {
    // Do not allow PASSIVE events to be deleted
    const activeEvents = await this.sessionEventRepository.find({
      select: ['id'],
      where: {
        id: In(eventIds),
        visibilityType: SessionEventVisibilityType.ACTIVE,
      },
    });

    const activeEventsIds: string[] = activeEvents.map((event) => event.id);
    if (activeEventsIds.length === 0) {
      throw new BadRequestException('No active events found to delete');
    }

    await this.dataSource.transaction(async (em) => {
      await em.getRepository(SessionEvents).softDelete({
        id: In(activeEventsIds),
      });
      await em.getRepository(ScenarioEvents).softDelete({
        eventId: In(activeEventsIds),
      });
    });
    return true;
  }
}
