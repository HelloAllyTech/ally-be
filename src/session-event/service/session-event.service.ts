import { Injectable } from '@nestjs/common';
import { CreateSessionEventDto } from '../dto/create-session-event.dto';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { SessionEvents } from '../entity/session-events.entity';
import { ScenarioEvents } from 'src/learn/entity/scenario-events.entity';

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
}
