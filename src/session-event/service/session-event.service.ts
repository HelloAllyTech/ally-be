import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateSessionEventDto } from '../dto/create-session-event.dto';
import { DeepPartial, In, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { SessionEvents } from '../entity/session-events.entity';
import { ScenarioEvents } from 'src/learn/entity/scenario-events.entity';
import { UpdateSessionEventDto } from '../dto/update-session-event.dto';

@Injectable()
export class SessionEventService {
  constructor(
    @InjectRepository(SessionEvents)
    private readonly sessionEventRepository: Repository<SessionEvents>,
  ) {}

  async createSessionEvents(
    createEventDtos: CreateSessionEventDto[],
  ): Promise<SessionEvents[]> {
    const events = this.sessionEventRepository.create(createEventDtos);
    return this.sessionEventRepository.save(events);
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
      .where('scenarioEvents.scenarioId = :scenarioId', {
        scenarioId: scenarioId,
      })
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
}
