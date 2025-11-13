import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateSessionEventDto } from '../dto/create-session-event.dto';
import { DataSource, In } from 'typeorm';
import { SessionEvents } from '../entity/session-events.entity';
import { ScenarioEvents } from 'src/learn/entity/scenario-events.entity';
import { UpdateSessionEventDto } from '../dto/update-session-event.dto';
import { Pagination } from 'src/common/type/common.type';
import { SessionEventRepository } from '../repository/session-event.repository';
import { SessionEventVisibilityType } from '../enum/session-event-visibility-type.enum';
import { v4 } from 'uuid';

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
      return {
        id: v4(),
        ...event,
      };
    });
    return this.sessionEventRepository.save(events);
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
        visibilityType: event.sessionEvents_visibilityType,
        detectionData: event.sessionEvents_detectionData,
        feedbackStatus: event.scenarioEvents_feedbackStatus,
        speaker: event.sessionEvents_speaker,
        createdAt: event.sessionEvents_createdAt,
        updatedAt: event.sessionEvents_updatedAt,
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
    const updated = await this.sessionEventRepository.update(
      id,
      updateEventDto as Partial<SessionEvents>,
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

  async getAllSessionEvents(
    visibilityType?: SessionEventVisibilityType,
    searchName?: string,
    pagination?: Pagination,
  ): Promise<{ data: SessionEvents[] }> {
    const sessionEvents = await this.sessionEventRepository.getAllSessionEvents(
      visibilityType,
      searchName,
      pagination,
    );
    return { data: sessionEvents };
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
