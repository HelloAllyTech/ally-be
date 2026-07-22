import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { AgentTestCase } from '../entity/agent-test-case.entity';
import { Pagination } from 'src/common/type/common.type';
import { LoggerService } from 'src/logger/logger.service';
import { AgentTestCaseSortBy } from '../enum/agent-test-case.enum';

@Injectable()
export class AgentTestCaseRepository extends Repository<AgentTestCase> {
  private readonly logger = LoggerService.getInstance(
    AgentTestCaseRepository.name,
  );

  constructor(private dataSource: DataSource) {
    super(AgentTestCase, dataSource.createEntityManager());
  }

  async getAgentTestCases(search?: string, options?: Pagination) {
    const query = this.createQueryBuilder('goal');
    this.logger.info(`Getting agent test cases with search: ${search}`);
    if (search) {
      const searchTerm = `%${search.trim()}%`;
      query.where(
        '(goal.title ILIKE :search OR goal.tags::text ILIKE :search)',
        {
          search: searchTerm,
        },
      );
    }
    if (options) {
      this.applySorting(query, options);
      this.applyPagination(query, options);
    }
    const [data, count] = await query.getManyAndCount();
    return { data, count };
  }

  async getAgentTestCaseById(id: string): Promise<AgentTestCase | null> {
    return this.findOne({ where: { id } });
  }

  private applySorting(
    query: SelectQueryBuilder<AgentTestCase>,
    options: Pagination,
  ) {
    const sortColumn = this.getValidatedSortColumn(
      options.sortBy || 'createdAt',
    );
    if (sortColumn) {
      query.orderBy(`goal.${sortColumn}`, options.order || 'ASC');
    }
  }

  private getValidatedSortColumn(sortBy?: string): string {
    if (!sortBy) {
      return AgentTestCaseSortBy.CREATED_AT;
    }
    const validColumns = Object.values(AgentTestCaseSortBy);
    return validColumns.includes(sortBy as AgentTestCaseSortBy)
      ? sortBy
      : AgentTestCaseSortBy.CREATED_AT;
  }

  private applyPagination(
    query: SelectQueryBuilder<AgentTestCase>,
    options: Pagination,
  ) {
    if (options.offset) {
      query.offset(options.offset);
    }
    if (options.limit) {
      query.limit(options.limit);
    }
  }
}
