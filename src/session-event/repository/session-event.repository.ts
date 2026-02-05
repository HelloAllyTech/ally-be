import {
  DataSource,
  DeepPartial,
  In,
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
import {
  EVENT_TYPE_PREFIX_MAP,
  SYSTEM_EVENT_DETECTION_TYPES,
} from '../constants/event.constant';
import { SessionEventSortBy } from '../enum/session-event-sort-by.enum';

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

  async findByIds(ids: string[]): Promise<SessionEvents[]> {
    return this.find({ where: { id: In(ids) } });
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

  private getValidatedSortColumn(sortBy?: string): string {
    if (!sortBy) return 'createdAt';
    const allowedColumns = Object.values(SessionEventSortBy);
    if (allowedColumns.includes(sortBy as SessionEventSortBy)) {
      return sortBy;
    }
    return 'createdAt';
  }

  private applySorting(
    query: SelectQueryBuilder<SessionEvents>,
    pagination?: Pagination,
  ) {
    query
      .orderBy(
        `CASE WHEN sessionEvent.detectionType IN (:...SYSTEM_EVENT_DETECTION_TYPES) THEN 1 ELSE 0 END`,
        'ASC',
      )
      .setParameters({ SYSTEM_EVENT_DETECTION_TYPES })
      .addOrderBy(
        `sessionEvent.${this.getValidatedSortColumn(pagination?.sortBy)}`,
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
        `(scenarioEvents.scenarioId = :scenarioId AND sessionEvents.visibilityType = '${SessionEventVisibilityType.ACTIVE}') AND scenarioEvents.autoTerminationStatus = false`,
        {
          scenarioId,
        },
      )
      .orWhere(
        `sessionEvents.visibilityType = '${SessionEventVisibilityType.PASSIVE}'`,
      )
      .getRawMany();
  }

  /**
   * Fetch all unique tags from session_events table
   * @param search Optional search filter for tags
   * @returns Array of unique tag strings
   */
  async getUniqueTags(search?: string): Promise<string[]> {
    const query = this.createQueryBuilder('sessionEvent')
      .select('DISTINCT UNNEST(sessionEvent.tags)', 'tag')
      .andWhere('sessionEvent.tags IS NOT NULL')
      .andWhere('array_length(sessionEvent.tags, 1) > 0');

    if (search) {
      query.andWhere(
        'EXISTS (SELECT 1 FROM UNNEST(sessionEvent.tags) AS t WHERE t ILIKE :search)',
        {
          search: `%${search}%`,
        },
      );
    }

    query.orderBy('tag', 'ASC');

    const result = await query.getRawMany();
    return result
      .map((row) => row.tag)
      .filter((tag) => tag && tag.trim() !== '');
  }
}
