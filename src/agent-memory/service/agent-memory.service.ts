import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AiService } from 'src/ai/service/ai.service';
import { LoggerService } from 'src/logger/logger.service';

import {
  AGENT_MEMORY_BODY_MAX,
  AgentMemory,
} from '../entity/agent-memory.entity';
import {
  AgentMemoryAgent,
  AgentMemoryEmbeddingStatus,
  AgentMemoryStatus,
} from '../enum/agent-memory.enum';
import { AgentMemoryRepository } from '../repository/agent-memory.repository';

/** How many more ids to ask the index for than the caller wants, since repo scope and status are applied afterwards. */
const SEARCH_OVERSAMPLE = 3;

/** Default relevance floor for a lookup — a starting point, to be read off the retrieval log once there is data. */
export const AGENT_MEMORY_DEFAULT_MIN_SIMILARITY = 0.35;

/** Cap on hits a single lookup may return, whatever the caller asked for. */
export const AGENT_MEMORY_MAX_HITS = 10;

/** Give up re-embedding an entry after this many failures; a reindex resets it. */
const MAX_EMBEDDING_ATTEMPTS = 5;

export interface AgentMemoryHit {
  id: string;
  body: string;
  tags: string[];
  repos: string[] | null;
  pinned: boolean;
  similarity: number;
}

export interface WriteAgentMemoryParams {
  agent: AgentMemoryAgent;
  body: string;
  repos?: string[] | null;
  tags?: string[] | null;
  runId?: string | null;
  findingId?: string | null;
  createdBy?: number | null;
  pinned?: boolean;
  /**
   * Land the entry ACTIVE at once rather than as a CANDIDATE for the curator.
   * True for a human writing by hand — a person's entry is already curated.
   * False (default) for the agent, whose notes wait for the hourly pass.
   */
  curated?: boolean;
}

/**
 * The notebook: write an entry, search it by meaning, list what is in scope.
 *
 * Postgres is the system of record and the Weaviate index (ally-ai's
 * `AgentMemory` collection) is derived — the RoadmapVectorService contract.
 * Writes land in Postgres first and are then pushed to the index best-effort:
 * an entry the agent learned must never be lost because ally-ai was down, so a
 * failed embed is recorded on the row (`embeddingStatus`) and healed later,
 * not thrown.
 *
 * Search asks the index for ids by meaning, scoped to the agent, then resolves
 * them against live rows — which is what applies the repo scope, drops retired
 * entries and returns the text. The index never holds the text, so a stale
 * vector can at worst rank an entry wrongly, never show a wrong entry.
 *
 * Entries the agent writes land as CANDIDATE and wait for
 * `AgentMemoryCuratorService`'s hourly pass; entries a human writes land
 * ACTIVE, because a person's note is already curated. Only ACTIVE entries are
 * searched or rendered into a prompt.
 */
@Injectable()
export class AgentMemoryService {
  private readonly logger = LoggerService.getInstance(AgentMemoryService.name);

  constructor(
    private readonly repository: AgentMemoryRepository,
    private readonly aiService: AiService,
  ) {}

  async write(params: WriteAgentMemoryParams): Promise<AgentMemory> {
    const body = params.body?.trim() ?? '';
    if (!body) throw new BadRequestException('A memory entry needs a body.');
    if (body.length > AGENT_MEMORY_BODY_MAX) {
      throw new BadRequestException(
        `A memory entry is at most ${AGENT_MEMORY_BODY_MAX} characters (got ${body.length}). Write the one lesson, not the whole story.`,
      );
    }
    const repos = normaliseList(params.repos);
    const tags = normaliseList(params.tags);

    const saved = await this.repository.save(
      this.repository.create({
        agent: params.agent,
        body,
        repos: repos.length ? repos : null,
        tags: tags.length ? tags : null,
        status: params.curated
          ? AgentMemoryStatus.ACTIVE
          : AgentMemoryStatus.CANDIDATE,
        pinned: params.pinned ?? false,
        runId: params.runId ?? null,
        findingId: params.findingId ?? null,
        createdBy: params.createdBy ?? null,
        embeddingStatus: AgentMemoryEmbeddingStatus.PENDING,
      }),
    );
    await this.indexQuietly(saved);
    return this.repository.findOneOrFail({ where: { id: saved.id } });
  }

  /**
   * Nearest active entries for a query, narrowed to the repo in play. Returns
   * the text, because that is what the caller came for, and the similarity,
   * because that is what the telemetry records.
   */
  async search(params: {
    agent: AgentMemoryAgent;
    query: string;
    repo?: string;
    limit?: number;
    minSimilarity?: number;
  }): Promise<AgentMemoryHit[]> {
    const query = params.query?.trim() ?? '';
    if (!query) return [];
    const limit = Math.min(
      Math.max(params.limit ?? 3, 1),
      AGENT_MEMORY_MAX_HITS,
    );
    const floor = params.minSimilarity ?? AGENT_MEMORY_DEFAULT_MIN_SIMILARITY;

    const response = await this.aiService.findSimilarAgentMemories({
      query,
      agent: params.agent,
      limit: Math.min(limit * SEARCH_OVERSAMPLE, 50),
      threshold: floor,
    });
    const matches = response?.matches ?? [];
    if (!matches.length) return [];

    const similarity = new Map(
      matches.map((m) => [m.memory_id, Number(m.similarity)]),
    );
    const rows = await this.repository.findByIds([...similarity.keys()]);

    return rows
      .filter((row) => row.status === AgentMemoryStatus.ACTIVE)
      .filter((row) => inScope(row, params.repo))
      .map((row) => ({
        id: row.id,
        body: row.body,
        tags: row.tags ?? [],
        repos: row.repos ?? null,
        pinned: row.pinned,
        similarity: similarity.get(row.id) ?? 0,
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /** The always-on subset a prompt may carry, ranked by evidence rather than by a query. */
  listActive(
    agent: AgentMemoryAgent,
    repo: string | undefined,
    limit: number,
  ): Promise<AgentMemory[]> {
    return this.repository.listActiveForRepo(agent, repo, limit);
  }

  async retire(id: string, userId: number | null): Promise<AgentMemory> {
    const row = await this.repository.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Memory entry ${id} not found`);
    await this.repository.update(id, {
      status: AgentMemoryStatus.RETIRED,
      createdBy: userId ?? row.createdBy ?? null,
    });
    try {
      await this.aiService.deleteAgentMemory(id);
      await this.repository.update(id, {
        embeddingStatus: AgentMemoryEmbeddingStatus.SKIPPED,
      });
    } catch (error) {
      this.logger.warn(
        `Agent memory ${id} retired in Postgres but its vector could not be removed; it may rank until the next reindex. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return this.repository.findOneOrFail({ where: { id } });
  }

  /**
   * After the curator rewrote or retired entries: re-embed the ones still
   * active (their text changed) and remove the vector of the ones that are
   * not. Best-effort, like every index write here.
   */
  async resyncVectors(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const rows = await this.repository.findByIds(ids);
    for (const row of rows) {
      if (row.status === AgentMemoryStatus.ACTIVE) {
        await this.indexQuietly(row);
        continue;
      }
      try {
        await this.aiService.deleteAgentMemory(row.id);
        await this.repository.update(row.id, {
          embeddingStatus: AgentMemoryEmbeddingStatus.SKIPPED,
        });
      } catch (error) {
        this.logger.warn(
          `Agent memory ${row.id} left the active set but its vector could not be removed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /** Push missing or stale vectors. Returns how many were attempted and how many succeeded. */
  async reindexPending(
    limit = 100,
  ): Promise<{ attempted: number; succeeded: number }> {
    const rows = await this.repository.listNeedingEmbedding(limit);
    let succeeded = 0;
    for (const row of rows) {
      if (row.embeddingAttempts >= MAX_EMBEDDING_ATTEMPTS) continue;
      if (await this.indexQuietly(row)) succeeded += 1;
    }
    return { attempted: rows.length, succeeded };
  }

  /** Best-effort push of one row to the index; records the outcome on the row. */
  private async indexQuietly(row: AgentMemory): Promise<boolean> {
    try {
      const response = await this.aiService.upsertAgentMemory({
        memory_id: row.id,
        body: row.body,
        agent: row.agent,
      });
      await this.repository.update(row.id, {
        embeddingStatus: AgentMemoryEmbeddingStatus.SUCCESS,
        embeddedAt: new Date(),
        embeddingAttempts: 0,
        textHash: response?.text_hash ?? null,
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `Agent memory ${row.id} saved but not indexed (attempt ${row.embeddingAttempts + 1}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.repository.update(row.id, {
        embeddingStatus: AgentMemoryEmbeddingStatus.FAILED,
        embeddingAttempts: row.embeddingAttempts + 1,
      });
      return false;
    }
  }
}

function normaliseList(values: string[] | null | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .map((v) => String(v).trim().toLowerCase())
        .filter((v) => v.length > 0),
    ),
  ];
}

function inScope(row: AgentMemory, repo: string | undefined): boolean {
  if (!row.repos || row.repos.length === 0) return true;
  if (!repo) return false;
  return row.repos.includes(repo);
}
