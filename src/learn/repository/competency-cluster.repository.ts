import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { CompetencyCluster } from '../entity/competency-cluster.entity';

@Injectable()
export class CompetencyClusterRepository extends Repository<CompetencyCluster> {
  constructor(private dataSource: DataSource) {
    super(CompetencyCluster, dataSource.createEntityManager());
  }

  async getClusters(name?: string): Promise<CompetencyCluster[]> {
    const query = this.createQueryBuilder('cluster').orderBy(
      'cluster.name',
      'ASC',
    );
    if (name?.trim()) {
      query.andWhere('cluster.name ILIKE :name', {
        name: `%${name.trim()}%`,
      });
    }
    return query.getMany();
  }

  async getClusterById(id: string): Promise<CompetencyCluster | null> {
    return this.findOne({ where: { id } });
  }

  /**
   * Case-insensitive name lookup. Cluster names are what an author picks from,
   * so two names differing only in case have to resolve to the same cluster —
   * the unique index is on LOWER(name) for the same reason.
   */
  async getClusterByName(name: string): Promise<CompetencyCluster | null> {
    return this.createQueryBuilder('cluster')
      .where('LOWER(cluster.name) = LOWER(:name)', { name: name.trim() })
      .getOne();
  }
}
