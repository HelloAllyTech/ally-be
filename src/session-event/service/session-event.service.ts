import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateSessionEventDto } from '../dto/create-session-event.dto';
import { In } from 'typeorm';
import { SessionEvents } from '../entity/session-events.entity';
import { ScenarioEvents } from 'src/learn/entity/scenario-events.entity';
import { UpdateSessionEventDto } from '../dto/update-session-event.dto';
import { Pagination } from 'src/common/type/common.type';
import { SessionEventRepository } from '../repository/session-event.repository';
import { SessionEventVisibilityType } from '../enum/session-event-visibility-type.enum';

@Injectable()
export class SessionEventService {
  constructor(
    private readonly sessionEventRepository: SessionEventRepository,
  ) {}

  async createSessionEvents(
    createEventDtos: CreateSessionEventDto[],
  ): Promise<SessionEvents[]> {
    return this.sessionEventRepository.save(createEventDtos);
  }

  async getSessionEventsByScenarioId(
    scenarioId: number,
  ): Promise<SessionEvents[]> {
    return this.sessionEventRepository
      .createQueryBuilder('sessionEvents')
      .leftJoin(
        ScenarioEvents,
        'scenarioEvents',
        'scenarioEvents.eventId = sessionEvents.id',
      )
      .where(
        `(scenarioEvents.scenarioId = :scenarioId AND sessionEvents.visibilityType = '${SessionEventVisibilityType.ACTIVE}') `,
        {
          scenarioId,
        },
      )
      .orWhere(
        `sessionEvents.visibilityType = '${SessionEventVisibilityType.PASSIVE}'`,
      )
      .getMany();
  }

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
    pagination?: Pagination,
  ): Promise<{ data: SessionEvents[] }> {
    const sessionEvents = await this.sessionEventRepository.getAllSessionEvents(
      visibilityType,
      pagination,
    );
    return { data: sessionEvents };
  }
}
