import { Injectable } from '@nestjs/common';
import { Brackets, DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { ScenarioReport } from '../entity/scenario-report.entity';
import { SCENARIO_REPORT_PENDING_STATUSES } from '../constants/scenario-report.constant';
import { TIME } from 'src/common/constants/time.constants';
import { Pagination, SortOrder } from 'src/common/type/common.type';
import { ScenarioReportSortBy } from '../type/scenario-report-sort-by.type';

@Injectable()
export class ScenarioReportRepository extends Repository<ScenarioReport> {
  constructor(private readonly dataSource: DataSource) {
    super(ScenarioReport, dataSource.createEntityManager());
  }

  async getAllScenarioReportsAndCount(
    scenarioId: number,
    statuses?: string[],
    pagination?: Pagination,
  ): Promise<[ScenarioReport[], number]> {
    const qb = this.createQueryBuilder('report').where(
      'report.scenarioId = :scenarioId',
      { scenarioId },
    );
    if (statuses && statuses.length > 0) {
      qb.andWhere('report.status IN (:...statuses)', { statuses });
    }

    this.applyPagination(qb, pagination?.limit, pagination?.offset);
    this.applySorting(qb, pagination?.sortBy, pagination?.order as SortOrder);

    return qb.getManyAndCount();
  }

  private applyPagination(
    qb: SelectQueryBuilder<ScenarioReport>,
    limit?: number,
    offset?: number,
  ) {
    if (limit) {
      qb.limit(limit);
    }
    if (offset) {
      qb.offset(offset);
    }
  }

  private getValidatedSortColumn(sortBy?: string): string | null {
    if (!sortBy) {
      return null;
    }
    const validColumns = Object.values(ScenarioReportSortBy);
    return validColumns.includes(sortBy as ScenarioReportSortBy)
      ? sortBy
      : ScenarioReportSortBy.CREATED_AT;
  }

  private applySorting(
    qb: SelectQueryBuilder<ScenarioReport>,
    sortBy?: string,
    order?: SortOrder,
  ) {
    if (sortBy) {
      const sortColumn = this.getValidatedSortColumn(sortBy);
      if (sortColumn) {
        return qb.orderBy(`report.${sortColumn}`, order || SortOrder.DESC);
      }
    }
    return qb.orderBy('report.createdAt', SortOrder.DESC);
  }

  async findRecentReportsByCreatedBy(
    createdBy: number,
    lookbackMinutes?: number,
  ): Promise<ScenarioReport[]> {
    const qb = this.createQueryBuilder('report').where(
      'report.createdBy = :createdBy',
      { createdBy },
    );

    if (lookbackMinutes) {
      const sinceDate = new Date(
        Date.now() - lookbackMinutes * TIME.MINUTE_IN_MS,
      );
      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('report.status IN (:...activeStatuses)', {
              activeStatuses: SCENARIO_REPORT_PENDING_STATUSES,
            })
            .orWhere('report.createdAt >= :sinceDate', { sinceDate })
            .orWhere('report.endedAt >= :sinceDate', { sinceDate });
        }),
      );
    }

    return qb.getMany();
  }
}
