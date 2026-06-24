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
   * Next version number for a scenario, computed over NON-deleted rows only, so
   * the number of a deleted top version is reused (delete v18 → next is v18).
   * The partial unique index is scoped to `deletedAt IS NULL`, so the new live
   * row never collides with the soft-deleted one. Safe to call inside a
   * transaction by passing the entity manager.
   */
  async getNextVersionNumber(
    scenarioId: number,
    em?: EntityManager,
  ): Promise<number> {
    const repo = em ? em.getRepository(ScenarioVersion) : this;
    const row = await repo
      .createQueryBuilder('v')
      .select('MAX(v.versionNumber)', 'max')
      .where('v.scenarioId = :scenarioId', { scenarioId })
      .andWhere('v.deletedAt IS NULL')
      .getRawOne<{ max: string | null }>();
    return (row?.max ? Number(row.max) : 0) + 1;
  }
}
