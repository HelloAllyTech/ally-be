import { Injectable } from '@nestjs/common';
import { Brackets, DataSource, Repository } from 'typeorm';
import { ScenarioReport } from '../entity/scenario-report.entity';
import { ScenarioReportStatus } from '../enum/scenario-report.enum';

@Injectable()
export class ScenarioReportRepository extends Repository<ScenarioReport> {
  constructor(private readonly dataSource: DataSource) {
    super(ScenarioReport, dataSource.createEntityManager());
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
      const sinceDate = new Date(Date.now() - lookbackMinutes * 60 * 1000);
      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('report.status IN (:...activeStatuses)', {
              activeStatuses: [
                ScenarioReportStatus.STARTED,
                ScenarioReportStatus.IN_PROGRESS,
              ],
            })
            .orWhere('report.createdAt >= :sinceDate', { sinceDate })
            .orWhere('report.endedAt >= :sinceDate', { sinceDate });
        }),
      );
    }

    return qb.getMany();
  }
}
