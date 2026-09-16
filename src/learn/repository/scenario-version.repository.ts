import { Injectable } from '@nestjs/common';
import {
  DataSource,
  EntityManager,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { ScenarioVersion } from '../entity/scenario-version.entity';
import { ScenarioVersionStatus } from '../enum/scenario-version-status.enum';

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

  /** Draft versions edited within the window — candidates for the daily auto-version job. */
  async findDraftsUpdatedSince(since: Date): Promise<ScenarioVersion[]> {
    return this.find({
      where: {
        status: ScenarioVersionStatus.DRAFT,
        updatedAt: MoreThanOrEqual(since),
      },
    });
  }
}
