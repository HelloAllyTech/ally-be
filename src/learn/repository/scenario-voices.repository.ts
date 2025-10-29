import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { ScenarioVoices } from '../entity/scenario-voices.entity';
import { Pagination } from 'src/common/type/common.type';

@Injectable()
export class ScenarioVoicesRepository extends Repository<ScenarioVoices> {
  constructor(private dataSource: DataSource) {
    super(ScenarioVoices, dataSource.createEntityManager());
  }

  async getScenarioVoices(options: Pagination): Promise<ScenarioVoices[]> {
    const query = this.createQueryBuilder('scenarioVoice');
    this.applySorting(query, options);
    this.applyPagination(query, options);
    return query.getMany();
  }

  private applySorting(
    query: SelectQueryBuilder<ScenarioVoices>,
    options: Pagination,
  ) {
    query.orderBy(
      `scenarioVoice.${options.sortBy || 'createdAt'}`,
      options.order || 'ASC',
    );
  }

  private applyPagination(
    query: SelectQueryBuilder<ScenarioVoices>,
    options: Pagination,
  ) {
    query.offset(options.offset || 0);
    query.limit(options.limit || 10);
  }
}
