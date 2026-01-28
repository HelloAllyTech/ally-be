// create a trigger-warnings repository layer that extends the Repository<TriggerWarnings>
import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { TriggerWarnings } from '../entity/trigger-warnings.entity';
import { Pagination } from 'src/common/type/common.type';
import { LoggerService } from 'src/logger/logger.service';
import { TriggerWarningsSortBy } from '../enum/trigger-warnings-sort-by.enum';

@Injectable()
export class TriggerWarningsRepository extends Repository<TriggerWarnings> {
  private readonly logger = LoggerService.getInstance(
    TriggerWarningsRepository.name,
  );
  constructor(private dataSource: DataSource) {
    super(TriggerWarnings, dataSource.createEntityManager());
  }

  async getTriggerWarnings(name?: string, options?: Pagination) {
    const query = this.createQueryBuilder('triggerWarning');
    this.logger.info(`Getting trigger warnings with name: ${name}`);
    if (name) {
      const searchTerm = `%${name.trim()}%`;
      query.where('triggerWarning.name ILIKE :name', { name: searchTerm });
    }
    if (options) {
      this.applySorting(query, options);
      this.applyPagination(query, options);
    }
    return query.getMany();
  }

  private applySorting(
    query: SelectQueryBuilder<TriggerWarnings>,
    options: Pagination,
  ) {
    const sortColumn = this.getValidatedSortColumn(
      options.sortBy || 'createdAt',
    );
    if (sortColumn) {
      query.orderBy(`triggerWarning.${sortColumn}`, options.order || 'ASC');
    }
  }

  private getValidatedSortColumn(sortBy?: string): string | null {
    if (!sortBy) {
      return TriggerWarningsSortBy.CREATED_AT;
    }
    const validColumns = Object.values(TriggerWarningsSortBy);
    return validColumns.includes(sortBy as TriggerWarningsSortBy)
      ? sortBy
      : TriggerWarningsSortBy.CREATED_AT;
  }

  private applyPagination(
    query: SelectQueryBuilder<TriggerWarnings>,
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
