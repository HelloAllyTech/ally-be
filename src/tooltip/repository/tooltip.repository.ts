import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { Tooltip } from '../entity/tooltip.entity';
import { Pagination } from 'src/common/type/common.type';
import { TooltipSortBy } from '../enum/tooltip-sort-by.enum';

@Injectable()
export class TooltipRepository extends Repository<Tooltip> {
  constructor(private dataSource: DataSource) {
    super(Tooltip, dataSource.createEntityManager());
  }

  getTooltips(search?: string, options?: Pagination): Promise<Tooltip[]> {
    const query = this.createQueryBuilder('tooltip');

    if (search?.trim()) {
      query.andWhere(
        '(tooltip.location ILIKE :search OR tooltip.tipText ILIKE :search)',
        { search: `%${search.trim()}%` },
      );
    }

    if (options) {
      this.applySorting(query, options);
      this.applyPagination(query, options);
    }

    return query.getMany();
  }

  private applySorting(
    query: SelectQueryBuilder<Tooltip>,
    options: Pagination,
  ): void {
    const validColumns = Object.values(TooltipSortBy);
    const sortColumn = validColumns.includes(options.sortBy as TooltipSortBy)
      ? options.sortBy!
      : TooltipSortBy.CREATED_AT;
    query.orderBy(`tooltip.${sortColumn}`, options.order || 'ASC');
  }

  private applyPagination(
    query: SelectQueryBuilder<Tooltip>,
    options: Pagination,
  ): void {
    if (options.offset) query.offset(options.offset);
    if (options.limit) query.limit(options.limit);
  }
}
