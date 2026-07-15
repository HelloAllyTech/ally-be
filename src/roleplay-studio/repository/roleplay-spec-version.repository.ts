import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { RoleplaySpecVersion } from '../entity/roleplay-spec-version.entity';

@Injectable()
export class RoleplaySpecVersionRepository extends Repository<RoleplaySpecVersion> {
  constructor(private readonly dataSource: DataSource) {
    super(RoleplaySpecVersion, dataSource.createEntityManager());
  }

  listBySpec(specId: string, limit?: number): Promise<RoleplaySpecVersion[]> {
    return this.find({
      where: { specId },
      order: { versionNumber: 'DESC' },
      ...(limit ? { take: limit } : {}),
    });
  }

  /**
   * Next monotonic version number for a spec. Read inside the caller's
   * transaction; a duplicate-key retry at the call site covers the
   * read-then-insert race (same pattern as scenario_versions).
   */
  async getNextVersionNumber(
    specId: string,
    manager?: EntityManager,
  ): Promise<number> {
    const repo = manager
      ? manager.getRepository(RoleplaySpecVersion)
      : (this as Repository<RoleplaySpecVersion>);
    const result: { max: string | null }[] = await repo
      .createQueryBuilder('version')
      .withDeleted()
      .select('MAX(version.versionNumber)', 'max')
      .where('version.specId = :specId', { specId })
      .getRawMany();
    const max = result[0]?.max ? Number(result[0].max) : 0;
    return max + 1;
  }
}
