import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { ScenarioEvents } from '../entity/scenario-events.entity';
import { Pagination } from 'src/common/type/common.type';
import { SessionEvents } from 'src/session-event/entity/session-events.entity';
import { SortOrder } from 'src/user/enum/user.enum';

@Injectable()
export class ScenarioEventsRepository extends Repository<ScenarioEvents> {
  constructor(private dataSource: DataSource) {
    super(ScenarioEvents, dataSource.createEntityManager());
  }

  async getScenarioEvents(
    scenarioId: number,
    options?: Pagination,
  ): Promise<{
    data: (ScenarioEvents & { sessionEvent: SessionEvents | null })[];
    count: number;
  }> {
    const query = this.createQueryBuilder('scenarioEvent')
      .leftJoinAndMapOne(
        'scenarioEvent.sessionEvent',
        SessionEvents,
        'sessionEvent',
        'sessionEvent.id = scenarioEvent.eventId AND sessionEvent.deletedAt IS NULL AND scenarioEvent.autoTerminationStatus = :autoTerminationStatus',
        { autoTerminationStatus: false },
      )
      .where(
        `(scenarioEvent.scenarioId = :scenarioId AND scenarioEvent.deletedAt IS NULL)`,
        { scenarioId },
      );
    this.applyPagination(query, options);
    this.applySort(query, options);

    const data = await query.getManyAndCount();
    return {
      data: data[0] as (ScenarioEvents & {
        sessionEvent: SessionEvents | null;
      })[],
      count: data[1],
    };
  }

  private applyPagination(
    query: SelectQueryBuilder<ScenarioEvents>,
    options?: Pagination,
  ): void {
    if (options?.limit) {
      query.limit(options.limit);
    }
    if (options?.offset) {
      query.offset(options.offset);
    }
  }

  private applySort(
    query: SelectQueryBuilder<ScenarioEvents>,
    options?: Pagination,
  ): void {
    if (options?.sortBy) {
      query.orderBy(
        `scenarioEvent.${options.sortBy}`,
        options.order || SortOrder.DESC,
      );
    }
  }
}
