import { Injectable } from '@nestjs/common';
import { DataSource, In, Repository, SelectQueryBuilder } from 'typeorm';
import { Behavior } from '../entity/behavior.entity';
import { Pagination } from 'src/common/type/common.type';
import { LoggerService } from 'src/logger/logger.service';
import { BehaviorSortBy } from '../enum/behavior.enum';

@Injectable()
export class BehaviorRepository extends Repository<Behavior> {
  private readonly logger = LoggerService.getInstance(BehaviorRepository.name);

  constructor(private dataSource: DataSource) {
    super(Behavior, dataSource.createEntityManager());
  }

  async getBehaviors(name?: string, options?: Pagination) {
    const query = this.createQueryBuilder('behavior');
    this.logger.info(`Getting behaviors with name: ${name}`);
    if (name) {
      const searchTerm = `%${name.trim()}%`;
      query.where('behavior.name ILIKE :name', { name: searchTerm });
    }
    if (options) {
      this.applySorting(query, options);
      this.applyPagination(query, options);
    }
    const [data, count] = await query.getManyAndCount();
    return { data, count };
  }

  async getBehaviorsByIds(ids: string[]): Promise<Behavior[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.find({
      where: { id: In(ids) },
    });
  }

  // Case-insensitive lookup by exact names — used to find-or-create behaviours
  // from free-text competency behaviour entries.
  async getBehaviorsByNames(names: string[]): Promise<Behavior[]> {
    if (names.length === 0) {
      return [];
    }
    return this.createQueryBuilder('behavior')
      .where('LOWER(behavior.name) IN (:...names)', {
        names: names.map((n) => n.toLowerCase()),
      })
      .getMany();
  }

  private applySorting(
    query: SelectQueryBuilder<Behavior>,
    options: Pagination,
  ) {
    const sortColumn = this.getValidatedSortColumn(
      options.sortBy || 'createdAt',
    );
    if (sortColumn) {
      query.orderBy(`behavior.${sortColumn}`, options.order || 'ASC');
    }
  }

  private getValidatedSortColumn(sortBy?: string): string | null {
    if (!sortBy) {
      return BehaviorSortBy.CREATED_AT;
    }
    const validColumns = Object.values(BehaviorSortBy);
    return validColumns.includes(sortBy as BehaviorSortBy)
      ? sortBy
      : BehaviorSortBy.CREATED_AT;
  }

  private applyPagination(
    query: SelectQueryBuilder<Behavior>,
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
