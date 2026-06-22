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

  async getCompetencies(
    name?: string,
    options?: Pagination,
    scope?: { includeOwnCustom?: boolean; userId?: number },
  ) {
    const query = this.createQueryBuilder('competency');
    this.logger.info(`Getting competencies with name: ${name}`);
    if (name) {
      const searchTerm = `%${name.trim()}%`;
      query.andWhere('competency.name ILIKE :name', { name: searchTerm });
    }

    // Custom competencies are user-private: never returned by default. When the
    // caller opts in (the simulation builder dropdown), include only the
    // requester's own customs alongside the global (non-custom) ones.
    if (scope?.includeOwnCustom && scope.userId != null) {
      query.andWhere(
        '(competency.isCustom = false OR competency.createdBy = :userId)',
        { userId: scope.userId },
      );
    } else {
      query.andWhere('competency.isCustom = false');
    }

    if (options) {
      this.applySorting(query, options);
      this.applyPagination(query, options);
    }
    const [data, count] = await query.getManyAndCount();
    return { data, count };
  }

  /**
   * The highest `N` already used by this user's auto-named custom competencies
   * (names of the form `{userId}_custom_{N}`), or 0 if none exist.
   */
  async getMaxCustomIndexForUser(userId: number): Promise<number> {
    const prefix = `${userId}_custom_`;
    const rows = await this.createQueryBuilder('competency')
      .select('competency.name', 'name')
      .where('competency.isCustom = true')
      .andWhere('competency.createdBy = :userId', { userId })
      .andWhere('competency.name LIKE :prefix', { prefix: `${prefix}%` })
      .getRawMany<{ name: string }>();

    const pattern = new RegExp(`^${userId}_custom_(\\d+)$`);
    let max = 0;
    for (const { name } of rows) {
      const match = pattern.exec(name);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return max;
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
