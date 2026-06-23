import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ScenarioVersion } from '../entity/scenario-version.entity';

@Injectable()
export class ScenarioVersionRepository extends Repository<ScenarioVersion> {
  constructor(private dataSource: DataSource) {
    super(ScenarioVersion, dataSource.createEntityManager());
  }

  async listByScenario(scenarioId: number): Promise<ScenarioVersion[]> {
    return this.find({
      where: { scenarioId },
      order: { versionNumber: 'DESC' },
    });
  }

  /**
   * Next version number for a scenario. Counts soft-deleted rows too (via the
   * raw max) so numbers are never reused. Safe to call inside a transaction by
   * passing the entity manager.
   */
  async getNextVersionNumber(
    scenarioId: number,
    em?: EntityManager,
  ): Promise<number> {
    const repo = em ? em.getRepository(ScenarioVersion) : this;
    const row = await repo
      .createQueryBuilder('v')
      .withDeleted()
      .select('MAX(v.versionNumber)', 'max')
      .where('v.scenarioId = :scenarioId', { scenarioId })
      .getRawOne<{ max: string | null }>();
    return (row?.max ? Number(row.max) : 0) + 1;
  }
}
