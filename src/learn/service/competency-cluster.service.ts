import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CompetencyClusterRepository } from '../repository/competency-cluster.repository';
import { CompetencyClusterMemberRepository } from '../repository/competency-cluster-member.repository';
import {
  CompetencyClusterResponseDto,
  CreateCompetencyClusterDto,
  GetCompetencyClustersResponseDto,
  UpdateCompetencyClusterDto,
} from '../dto/competency-cluster.dto';
import { CompetencyClusterRefDto } from '../dto/competency.dto';

// Postgres unique-violation SQLSTATE, surfaced by TypeORM on the thrown error
// directly and/or on the wrapped driver error.
const PG_UNIQUE_VIOLATION = '23505';
function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; driverError?: { code?: string } };
  return (
    e?.code === PG_UNIQUE_VIOLATION ||
    e?.driverError?.code === PG_UNIQUE_VIOLATION
  );
}

@Injectable()
export class CompetencyClusterService {
  constructor(
    private readonly clusterRepository: CompetencyClusterRepository,
    private readonly memberRepository: CompetencyClusterMemberRepository,
  ) {}

  async getClusters(name?: string): Promise<GetCompetencyClustersResponseDto> {
    const clusters = await this.clusterRepository.getClusters(name);
    const membersByCluster =
      await this.memberRepository.getCompetencyIdsByCluster(
        clusters.map((cluster) => cluster.id),
      );
    return {
      data: clusters.map((cluster) => ({
        id: cluster.id,
        name: cluster.name,
        competencyIds: membersByCluster.get(cluster.id) ?? [],
      })),
      count: clusters.length,
    };
  }

  async createCluster(
    dto: CreateCompetencyClusterDto,
    createdBy?: number,
  ): Promise<CompetencyClusterResponseDto> {
    const cluster = await this.findOrCreateByName(dto.name, createdBy);
    if (dto.competencyIds) {
      await this.memberRepository.replaceForCluster(
        cluster.id,
        dto.competencyIds,
      );
    }
    return this.getCluster(cluster.id);
  }

  async updateCluster(
    id: string,
    dto: UpdateCompetencyClusterDto,
  ): Promise<CompetencyClusterResponseDto> {
    const cluster = await this.clusterRepository.getClusterById(id);
    if (!cluster) {
      throw new NotFoundException(`Competency cluster with id ${id} not found`);
    }

    if (dto.name !== undefined) {
      const clash = await this.clusterRepository.getClusterByName(dto.name);
      if (clash && clash.id !== id) {
        throw new ConflictException(
          `A cluster called "${clash.name}" already exists`,
        );
      }
      cluster.name = dto.name.trim();
      await this.clusterRepository.save(cluster);
    }

    // Membership is only touched when the caller says so — omitting the key
    // must not silently empty the cluster.
    if (dto.competencyIds !== undefined) {
      await this.memberRepository.replaceForCluster(id, dto.competencyIds);
    }

    return this.getCluster(id);
  }

  /**
   * Deleting a cluster is safe for published work: a scenario stores the
   * EXPANDED competency ids, never the cluster, so nothing downstream
   * dereferences it. The membership rows go with it via ON DELETE CASCADE.
   */
  async deleteCluster(id: string): Promise<void> {
    const cluster = await this.clusterRepository.getClusterById(id);
    if (!cluster) {
      throw new NotFoundException(`Competency cluster with id ${id} not found`);
    }
    await this.clusterRepository.delete(id);
  }

  async getCluster(id: string): Promise<CompetencyClusterResponseDto> {
    const cluster = await this.clusterRepository.getClusterById(id);
    if (!cluster) {
      throw new NotFoundException(`Competency cluster with id ${id} not found`);
    }
    return {
      id: cluster.id,
      name: cluster.name,
      competencyIds: await this.memberRepository.getCompetencyIdsForCluster(id),
    };
  }

  /**
   * Turns the cluster NAMES the competency editor sends into ids, creating any
   * that don't exist yet. Blank entries are dropped, and names that differ only
   * by case or surrounding space resolve to the same cluster.
   */
  async resolveClusterNames(
    names: string[],
    createdBy?: number,
  ): Promise<string[]> {
    const cleaned = [
      ...new Map(
        names
          .map((name) => name.trim())
          .filter((name) => name.length > 0)
          .map((name) => [name.toLowerCase(), name]),
      ).values(),
    ];
    const ids: string[] = [];
    for (const name of cleaned) {
      const cluster = await this.findOrCreateByName(name, createdBy);
      ids.push(cluster.id);
    }
    return ids;
  }

  /**
   * Replaces the clusters a competency belongs to, by name.
   */
  async setClustersForCompetency(
    competencyId: string,
    clusterNames: string[],
    createdBy?: number,
  ): Promise<void> {
    const clusterIds = await this.resolveClusterNames(clusterNames, createdBy);
    await this.memberRepository.replaceForCompetency(competencyId, clusterIds);
  }

  /**
   * competencyId -> the clusters it belongs to, for decorating a competency
   * list in a single query.
   */
  async getClustersByCompetency(
    competencyIds: string[],
  ): Promise<Map<string, CompetencyClusterRefDto[]>> {
    const rows =
      await this.memberRepository.getMembershipsForCompetencies(competencyIds);
    const byCompetency = new Map<string, CompetencyClusterRefDto[]>();
    for (const row of rows) {
      byCompetency.set(row.competencyId, [
        ...(byCompetency.get(row.competencyId) ?? []),
        { id: row.clusterId, name: row.clusterName },
      ]);
    }
    return byCompetency;
  }

  // Find-or-create on a case-insensitive name. Two authors typing the same new
  // cluster name at once both miss the SELECT, so the unique index on
  // LOWER(name) is what actually keeps it single — a lost race re-reads the
  // row the winner inserted rather than failing the request.
  private async findOrCreateByName(
    name: string,
    createdBy?: number,
  ): Promise<{ id: string; name: string }> {
    const trimmed = name.trim();
    const existing = await this.clusterRepository.getClusterByName(trimmed);
    if (existing) return existing;
    try {
      return await this.clusterRepository.save(
        this.clusterRepository.create({ name: trimmed, createdBy }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.clusterRepository.getClusterByName(trimmed);
        if (raced) return raced;
      }
      throw error;
    }
  }
}
