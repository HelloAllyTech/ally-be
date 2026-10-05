import { Injectable } from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';

import { AgentMemory } from '../entity/agent-memory.entity';
import { AgentMemoryAgent, AgentMemoryStatus } from '../enum/agent-memory.enum';

@Injectable()
export class AgentMemoryRepository extends Repository<AgentMemory> {
  constructor(dataSource: DataSource) {
    super(AgentMemory, dataSource.createEntityManager());
  }

  findByIds(ids: string[]): Promise<AgentMemory[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.find({ where: { id: In(ids) } });
  }

  /**
   * The active entries in scope for one repo, strongest evidence first —
   * pinned, then agreement across runs plus times applied less contradictions.
   * Platform-wide entries (no repos) are always in scope; repo-specific ones
   * only for that repo, so an ally-mobile gotcha does not take up room in a
   * backend sweep. Same ordering as `BuilderLessonRepository.listActiveForRepos`.
   */
  listActiveForRepo(
    agent: AgentMemoryAgent,
    repo: string | undefined,
    limit: number,
  ): Promise<AgentMemory[]> {
    const query = this.createQueryBuilder('m')
      .where('m.agent = :agent', { agent })
      .andWhere('m.status = :status', { status: AgentMemoryStatus.ACTIVE })
      .orderBy('m.pinned', 'DESC')
      .addOrderBy(
        'm.source_count + m.times_applied - 2 * m.times_contradicted',
        'DESC',
      )
      .addOrderBy('m."createdAt"', 'DESC')
      .take(limit);
    if (repo) {
      query.andWhere(
        `(m.repos IS NULL OR jsonb_array_length(m.repos) = 0 OR m.repos ? :repo)`,
        { repo },
      );
    } else {
      query.andWhere('(m.repos IS NULL OR jsonb_array_length(m.repos) = 0)');
    }
    return query.getMany();
  }

  /** One agent's entries in one status, oldest first — the curator's two inputs. */
  listByStatus(
    agent: AgentMemoryAgent,
    status: AgentMemoryStatus,
  ): Promise<AgentMemory[]> {
    return this.find({
      where: { agent, status },
      order: { createdAt: 'ASC' },
    });
  }

  /** Every active, unpinned entry of one agent — the nightly retirement pass's worklist. */
  listActiveUnpinned(agent: AgentMemoryAgent): Promise<AgentMemory[]> {
    return this.find({
      where: { agent, status: AgentMemoryStatus.ACTIVE, pinned: false },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Entries the agent itself retired recently (a reason and no retiring user),
   * newest first — what the Notebook tab shows under "retired by me", with an
   * Undo. Same repo scoping as the active list.
   */
  listRetiredByAgent(
    agent: AgentMemoryAgent,
    repo: string | undefined,
    since: Date,
    limit: number,
  ): Promise<AgentMemory[]> {
    const query = this.createQueryBuilder('m')
      .where('m.agent = :agent', { agent })
      .andWhere('m.status = :status', { status: AgentMemoryStatus.RETIRED })
      .andWhere('m.retired_by IS NULL')
      .andWhere('m.retired_reason IS NOT NULL')
      .andWhere('m.retired_at >= :since', { since })
      .orderBy('m.retired_at', 'DESC')
      .take(limit);
    if (repo) {
      query.andWhere(
        `(m.repos IS NULL OR jsonb_array_length(m.repos) = 0 OR m.repos ? :repo)`,
        { repo },
      );
    } else {
      query.andWhere('(m.repos IS NULL OR jsonb_array_length(m.repos) = 0)');
    }
    return query.getMany();
  }

  /** A run said these entries changed what it did: count it, and remember when. */
  async recordApplied(ids: string[], at: Date): Promise<number> {
    if (!ids.length) return 0;
    const result = await this.createQueryBuilder()
      .update(AgentMemory)
      .set({
        timesApplied: () => 'times_applied + 1',
        lastAppliedAt: at,
      })
      .where('id IN (:...ids)', { ids })
      .andWhere('status = :status', { status: AgentMemoryStatus.ACTIVE })
      .execute();
    return result.affected ?? 0;
  }

  /** A run said these entries turned out wrong tonight. */
  async recordContradicted(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const result = await this.createQueryBuilder()
      .update(AgentMemory)
      .set({ timesContradicted: () => 'times_contradicted + 1' })
      .where('id IN (:...ids)', { ids })
      .andWhere('status = :status', { status: AgentMemoryStatus.ACTIVE })
      .execute();
    return result.affected ?? 0;
  }

  /** Entries whose vector is missing or stale — the reindex sweep's worklist. */
  listNeedingEmbedding(limit: number): Promise<AgentMemory[]> {
    return this.createQueryBuilder('m')
      .where('m.status IN (:...statuses)', {
        statuses: [AgentMemoryStatus.ACTIVE, AgentMemoryStatus.CANDIDATE],
      })
      .andWhere('m.embedding_status IN (:...pending)', {
        pending: ['pending', 'failed'],
      })
      .orderBy('m."updatedAt"', 'ASC')
      .take(limit)
      .getMany();
  }
}
