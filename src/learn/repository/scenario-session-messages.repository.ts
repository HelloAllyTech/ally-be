import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { ScenarioSessionMessages } from '../entity/scenario-session-messages.entity';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { Pagination } from 'src/common/type/common.type';
import { ScenarioSessionMessageSortBy } from '../enum/scenario-session-message-sort-by.enum';

@Injectable()
export class ScenarioSessionMessagesRepository extends Repository<ScenarioSessionMessages> {
  constructor(private dataSource: DataSource) {
    super(ScenarioSessionMessages, dataSource.createEntityManager());
  }

  async getMessagesByScenarioSessionId(
    scenarioSessionId: string,
    pagination: Pagination,
  ): Promise<[ScenarioSessionMessages[], number]> {
    const query = this.createQueryBuilder('message')
      .where('message.scenarioSessionId = :scenarioSessionId', {
        scenarioSessionId,
      })
      .andWhere('message.tenantId = :tenantId', {
        tenantId: ExecutionManager.getTenantId(),
      });

    this.applySorting(query, pagination);
    this.applyPagination(query, pagination);

    return query.getManyAndCount();
  }

  private applySorting(
    query: SelectQueryBuilder<ScenarioSessionMessages>,
    pagination: Pagination,
  ) {
    const sortColumn = this.getValidatedSortColumn(
      pagination.sortBy || 'createdAt',
    );
    if (sortColumn) {
      query.orderBy(`message.${sortColumn}`, pagination.order || 'ASC');
    }
  }

  private getValidatedSortColumn(sortBy?: string): string | null {
    if (!sortBy) {
      return ScenarioSessionMessageSortBy.CREATED_AT;
    }
    const validColumns = Object.values(ScenarioSessionMessageSortBy);
    return validColumns.includes(sortBy as ScenarioSessionMessageSortBy)
      ? sortBy
      : ScenarioSessionMessageSortBy.CREATED_AT;
  }

  private applyPagination(
    query: SelectQueryBuilder<ScenarioSessionMessages>,
    pagination: Pagination,
  ) {
    if (pagination.limit) {
      query.limit(pagination.limit);
    }
    if (pagination.offset) {
      query.offset(pagination.offset);
    }
  }
}
