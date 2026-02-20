import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { ScenarioEvents } from '../entity/scenario-events.entity';
import { Pagination } from 'src/common/type/common.type';
import { SessionEvents } from 'src/session-event/entity/session-events.entity';
import { SortOrder } from 'src/user/enum/user.enum';
import { ScenarioEventsSortBy } from '../enum/scenario-events-sort-by-enum';
import { ScenarioSessionEvents } from '../entity/scenario-session-events.entity';

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
        'sessionEvent.id = scenarioEvent.eventId',
      )
      .where('scenarioEvent.scenarioId = :scenarioId', { scenarioId })
      .andWhere(
        'scenarioEvent.autoTerminationStatus = :autoTerminationStatus',
        {
          autoTerminationStatus: false,
        },
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

  private getValidatedSortColumn(sortBy?: string): string | null {
    if (!sortBy) return null;
    const allowedColumns = Object.values(ScenarioEventsSortBy);
    if (allowedColumns.includes(sortBy as ScenarioEventsSortBy)) {
      return sortBy;
    }
    return null;
  }

  private applySort(
    query: SelectQueryBuilder<ScenarioEvents>,
    options?: Pagination,
  ): void {
    if (options?.sortBy) {
      const sortColumn = this.getValidatedSortColumn(options.sortBy);
      if (sortColumn) {
        query.orderBy(
          `scenarioEvent.${sortColumn}`,
          options.order || SortOrder.DESC,
        );
      }
    }
  }

  async getEventChecklist(
    scenarioSessionId: string,
    scenarioId: number,
    options?: Pagination,
  ): Promise<
    (ScenarioEvents & {
      events: SessionEvents;
      scenarioSessionEvent: ScenarioSessionEvents[];
    })[]
  > {
    const query = this.createQueryBuilder('scenarioEvent')
      .leftJoinAndMapMany(
        'scenarioEvent.scenarioSessionEvent',
        ScenarioSessionEvents,
        'scenarioSessionEvent',
        'scenarioSessionEvent.eventId = scenarioEvent.eventId AND scenarioSessionEvent.scenarioSessionId = :scenarioSessionId',
      )
      .leftJoinAndMapOne(
        'scenarioEvent.events',
        SessionEvents,
        'events',
        'events.id = scenarioEvent.eventId',
      )
      .where('scenarioEvent.scenarioId = :scenarioId', {
        scenarioId,
      })
      .andWhere(
        '(scenarioEvent.checklistVisibilityStatus = :checklistVisible OR scenarioSessionEvent.id IS NOT NULL)',
        { checklistVisible: true },
      )
      .setParameters({
        scenarioSessionId: scenarioSessionId,
      });

    this.applyPagination(query, options);
    this.applySort(query, options);
    const data = await query.getMany();

    return data as (ScenarioEvents & {
      events: SessionEvents;
      scenarioSessionEvent: ScenarioSessionEvents[];
    })[];
  }
}
