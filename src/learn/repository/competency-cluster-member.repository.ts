import { Injectable } from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';
import { CompetencyClusterMember } from '../entity/competency-cluster-member.entity';

export interface ClusterMembershipRow {
  clusterId: string;
  clusterName: string;
  competencyId: string;
}

@Injectable()
export class CompetencyClusterMemberRepository extends Repository<CompetencyClusterMember> {
  constructor(private dataSource: DataSource) {
    super(CompetencyClusterMember, dataSource.createEntityManager());
  }

  /**
   * Every membership row for the given competencies, carrying the cluster name
   * so the competency list can be decorated in one round-trip instead of one
   * per competency.
   */
  async getMembershipsForCompetencies(
    competencyIds: string[],
  ): Promise<ClusterMembershipRow[]> {
    if (competencyIds.length === 0) return [];
    return this.createQueryBuilder('member')
      .innerJoin(
        'competency_clusters',
        'cluster',
        'cluster.id = member.clusterId',
      )
      .where('member.competencyId IN (:...competencyIds)', { competencyIds })
      .select([
        'member.clusterId AS "clusterId"',
        'cluster.name AS "clusterName"',
        'member.competencyId AS "competencyId"',
      ])
      .orderBy('cluster.name', 'ASC')
      .getRawMany<ClusterMembershipRow>();
  }

  async getCompetencyIdsForCluster(clusterId: string): Promise<string[]> {
    const rows = await this.find({
      where: { clusterId },
      select: ['competencyId'],
    });
    return rows.map((row) => row.competencyId);
  }

  /**
   * Membership for several clusters at once, as clusterId -> competencyIds.
   * The picker needs every cluster's members up front so selecting a cluster
   * can expand locally.
   */
  async getCompetencyIdsByCluster(
    clusterIds: string[],
  ): Promise<Map<string, string[]>> {
    const byCluster = new Map<string, string[]>();
    if (clusterIds.length === 0) return byCluster;
    const rows = await this.find({
      where: { clusterId: In(clusterIds) },
      select: ['clusterId', 'competencyId'],
    });
    for (const row of rows) {
      byCluster.set(row.clusterId, [
        ...(byCluster.get(row.clusterId) ?? []),
        row.competencyId,
      ]);
    }
    return byCluster;
  }

  /** Replaces the full set of clusters a competency belongs to. */
  async replaceForCompetency(
    competencyId: string,
    clusterIds: string[],
  ): Promise<void> {
    await this.delete({ competencyId });
    const unique = [...new Set(clusterIds)];
    if (unique.length === 0) return;
    await this.save(
      unique.map((clusterId) => this.create({ clusterId, competencyId })),
    );
  }

  /** Replaces the full set of competencies in a cluster. */
  async replaceForCluster(
    clusterId: string,
    competencyIds: string[],
  ): Promise<void> {
    await this.delete({ clusterId });
    const unique = [...new Set(competencyIds)];
    if (unique.length === 0) return;
    await this.save(
      unique.map((competencyId) => this.create({ clusterId, competencyId })),
    );
  }
}
