import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { Competency } from '../entity/competency.entity';
import { Pagination } from 'src/common/type/common.type';
import { LoggerService } from 'src/logger/logger.service';
import { CompetencySortBy } from '../enum/competency.enum';

@Injectable()
export class CompetencyRepository extends Repository<Competency> {
  private readonly logger = LoggerService.getInstance(
    CompetencyRepository.name,
  );

  constructor(private dataSource: DataSource) {
    super(Competency, dataSource.createEntityManager());
  }

  async getCompetencies(name?: string, options?: Pagination) {
    const query = this.createQueryBuilder('competency');
    this.logger.info(`Getting competencies with name: ${name}`);
    if (name) {
      const searchTerm = `%${name.trim()}%`;
      query.where('competency.name ILIKE :name', { name: searchTerm });
    }
    if (options) {
      this.applySorting(query, options);
      this.applyPagination(query, options);
    }
    const [data, count] = await query.getManyAndCount();
    return { data, count };
  }

  async getCompetencyById(id: string): Promise<Competency | null> {
    return this.findOne({ where: { id } });
  }

  private applySorting(
    query: SelectQueryBuilder<Competency>,
    options: Pagination,
  ) {
    const sortColumn = this.getValidatedSortColumn(
      options.sortBy || 'createdAt',
    );
    if (sortColumn) {
      query.orderBy(`competency.${sortColumn}`, options.order || 'ASC');
    }
  }

  private getValidatedSortColumn(sortBy?: string): string | null {
    if (!sortBy) {
      return CompetencySortBy.CREATED_AT;
    }
    const validColumns = Object.values(CompetencySortBy);
    return validColumns.includes(sortBy as CompetencySortBy)
      ? sortBy
      : CompetencySortBy.CREATED_AT;
  }

  private applyPagination(
    query: SelectQueryBuilder<Competency>,
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
