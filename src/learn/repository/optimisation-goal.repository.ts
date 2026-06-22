import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { OptimisationGoal } from '../entity/optimisation-goal.entity';
import { Pagination } from 'src/common/type/common.type';
import { LoggerService } from 'src/logger/logger.service';
import { OptimisationGoalSortBy } from '../enum/optimisation-goal.enum';

@Injectable()
export class OptimisationGoalRepository extends Repository<OptimisationGoal> {
  private readonly logger = LoggerService.getInstance(
    OptimisationGoalRepository.name,
  );

  constructor(private dataSource: DataSource) {
    super(OptimisationGoal, dataSource.createEntityManager());
  }

  async getOptimisationGoals(search?: string, options?: Pagination) {
    const query = this.createQueryBuilder('goal');
    this.logger.info(`Getting optimisation goals with search: ${search}`);
    if (search) {
      const searchTerm = `%${search.trim()}%`;
      query.where('(goal.title ILIKE :search OR goal.category ILIKE :search)', {
        search: searchTerm,
      });
    }
    if (options) {
      this.applySorting(query, options);
      this.applyPagination(query, options);
    }
    const [data, count] = await query.getManyAndCount();
    return { data, count };
  }

  async getOptimisationGoalById(id: string): Promise<OptimisationGoal | null> {
    return this.findOne({ where: { id } });
  }

  private applySorting(
    query: SelectQueryBuilder<OptimisationGoal>,
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
      return OptimisationGoalSortBy.CREATED_AT;
    }
    const validColumns = Object.values(OptimisationGoalSortBy);
    return validColumns.includes(sortBy as OptimisationGoalSortBy)
      ? sortBy
      : OptimisationGoalSortBy.CREATED_AT;
  }

  private applyPagination(
    query: SelectQueryBuilder<OptimisationGoal>,
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
