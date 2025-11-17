import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Scenarios } from '../entity/scenarios.entity';
import { Pagination } from 'src/common/type/common.type';
import { User } from 'src/user/entity/user.entity';
import { ScenarioSessions } from '../entity/scenario-sessions.entity';

@Injectable()
export class ScenariosRepository extends Repository<Scenarios> {
  constructor(private dataSource: DataSource) {
    super(Scenarios, dataSource.createEntityManager());
  }
  async getAdminScenarios(status?: string, options?: Pagination) {
    const query = this.createQueryBuilder('scenario')
      .leftJoin(User, 'user', 'scenario."createdBy"=user.id')
      .select(['scenario', 'user.name'])
      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(*)', 'count')
          .from(ScenarioSessions, 'scenarioSessions')
          .where('scenarioSessions.scenarioId = scenario.id');
      }, 'usage');

    if (status) {
      const statuses = this.parseStringArray(status);
      if (statuses.length > 0) {
        query.andWhere('scenario.status IN (:...statuses)', {
          statuses,
        });
      }
    }
    if (options?.sortBy) {
      if (options.sortBy === 'usage') {
        query.orderBy('usage', options.order as 'ASC' | 'DESC');
      } else {
        query.orderBy(
          `scenario.${options.sortBy}`,
          options.order as 'ASC' | 'DESC',
        );
      }
    }

    // Pagination
    if (options?.limit) {
      query.limit(options?.limit);
    }
    if (options?.offset) {
      query.offset(options?.offset);
    }

    return query.getRawMany();
  }

  private parseStringArray(value?: string): string[] {
    if (!value) return [];
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
}
