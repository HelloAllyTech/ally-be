import {
  DataSource,
  DeepPartial,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { SessionEvents } from '../entity/session-events.entity';
import { Pagination } from 'src/common/type/common.type';
import { Injectable } from '@nestjs/common';
import { SessionEventVisibilityType } from '../enum/session-event-visibility-type.enum';
import { ScenarioEvents } from 'src/learn/entity/scenario-events.entity';
import { CreateSessionEventDto } from '../dto/session-event.dto';
import { SessionEventDetectionType } from '../enum/session-event-detection.enum';
import { EVENT_TYPE_PREFIX_MAP } from '../constants/event-type.constant';

@Injectable()
export class SessionEventRepository extends Repository<SessionEvents> {
  constructor(private dataSource: DataSource) {
    super(SessionEvents, dataSource.createEntityManager());
  }

  async createSessionEvents(
    createEventDtos: CreateSessionEventDto[],
  ): Promise<SessionEvents[]> {
    const events: DeepPartial<SessionEvents>[] = await Promise.all(
      createEventDtos.map(async (event) => {
        const sequenceResult = await this.query(
          `SELECT nextval('session_events_event_code_seq') as next_value`,
        );

        const eventCode = sequenceResult[0]?.next_value || '0';
        const detectionType =
          event.detectionType || SessionEventDetectionType.SENTENCE_SIMILARITY;
        return this.create({
          ...event,
          eventCode: `${EVENT_TYPE_PREFIX_MAP[detectionType as SessionEventDetectionType]}${eventCode}`,
        } as DeepPartial<SessionEvents>);
      }),
    );
    return this.save(events);
  }

  async getAllSessionEvents(
    visibilityType?: SessionEventVisibilityType,
    searchName?: string,
    pagination?: Pagination,
  ): Promise<SessionEvents[]> {
    const query = this.createQueryBuilder('sessionEvent');
    if (visibilityType) {
      query.andWhere('sessionEvent.visibilityType = :visibilityType', {
        visibilityType,
      });
    }
    if (searchName) {
      query
        .andWhere(
          '(sessionEvent.name ILIKE :searchName OR sessionEvent.eventCode ILIKE :searchName)',
        )
        .setParameters({
          searchName: `%${searchName}%`,
        });
    }
    this.applySorting(query, pagination);
    this.applyPagination(query, pagination);
    return query.getMany();
  }

  private applySorting(
    query: SelectQueryBuilder<SessionEvents>,
    pagination?: Pagination,
  ) {
    query.orderBy(
      `sessionEvent.${pagination?.sortBy || 'createdAt'}`,
      pagination?.order || 'DESC',
    );
  }

  private applyPagination(
    query: SelectQueryBuilder<SessionEvents>,
    pagination?: Pagination,
  ) {
    if (pagination?.limit) {
      query.limit(pagination.limit);
    }
    if (pagination?.offset) {
      query.offset(pagination.offset);
    }
  }

  async getSessionEventsByScenarioId(scenarioId: number) {
    return this.createQueryBuilder('sessionEvents')
      .leftJoinAndSelect(
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
      .getRawMany();
  }
}
