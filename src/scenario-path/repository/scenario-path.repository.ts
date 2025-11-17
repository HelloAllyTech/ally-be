import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { ScenarioPath } from '../entity/scenario-path.entity';
import { ScenarioPathFilterOptions } from '../type/scenario-paths.type';

@Injectable()
export class ScenarioPathRepository extends Repository<ScenarioPath> {
  constructor(private dataSource: DataSource) {
    super(ScenarioPath, dataSource.createEntityManager());
  }

  async findAll(
    filters?: ScenarioPathFilterOptions,
  ): Promise<{ data: ScenarioPath[]; count: number }> {
    const query = this.createQueryBuilder('scenarioPath');

    this.applyStatusFilter(query, filters);
    this.applySearchFilter(query, filters);

    if (filters?.limit) {
      query.limit(filters.limit);
    }

    if (filters?.offset) {
      query.offset(filters.offset);
    }

    const [data, count] = await query.getManyAndCount();

    return { data, count };
  }

  private applyStatusFilter(
    query: SelectQueryBuilder<ScenarioPath>,
    filters?: ScenarioPathFilterOptions,
  ): void {
    if (filters?.status) {
      query.andWhere('scenarioPath.status = :status', {
        status: filters.status,
      });
    }
  }

  private applySearchFilter(
    query: SelectQueryBuilder<ScenarioPath>,
    filters?: ScenarioPathFilterOptions,
  ): void {
    if (filters?.search && filters.search.trim()) {
      const searchTerm = `%${filters.search.trim()}%`;
      query.andWhere('(scenarioPath.title ILIKE :search)', {
        search: searchTerm,
      });
    }
  }
}
