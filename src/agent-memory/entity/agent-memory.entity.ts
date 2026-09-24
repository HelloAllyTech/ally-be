import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

import {
  AgentMemoryAgent,
  AgentMemoryEmbeddingStatus,
  AgentMemoryStatus,
} from '../enum/agent-memory.enum';

/** Hard cap on an entry, in characters — an engineer's notebook line, not a document. */
export const AGENT_MEMORY_BODY_MAX = 600;

/**
 * One entry in an agent's notebook: a short lesson the agent (or a human)
 * wrote down so the next run does not have to rediscover it.
 *
 * The shape the product lead asked for, made a table: under 600 characters,
 * open tags so kinds of memory can emerge rather than being fixed up front,
 * scoped to one or more repos or platform-wide, written by the agent at
 * reflection points and by humans by hand, editable and retirable, and living
 * in a private store rather than the open repo.
 *
 * Postgres is the system of record. Semantic search runs over a derived
 * Weaviate index (ally-ai's `AgentMemory` collection) that holds the vector
 * and nothing of the text; `textHash` / `embeddingStatus` are the
 * reconciliation fields, borrowed from `RoadmapOpportunity`, that let a stale
 * or missing vector be detected and re-pushed.
 *
 * The curation columns (`status`, `pinned`, `sourceCount`, `timesApplied`,
 * `timesContradicted`, `mergedIntoId`) are `BuilderLesson`'s, so Builder's
 * curator can run over this table when its rows move here (OPP-0714). Bug
 * Hunter writes straight to ACTIVE until then.
 *
 * The CHECK constraints (agent, status, embedding_status, body length) live in
 * the introducing migration only. Never generate migrations against this table.
 */
@Entity('agent_memories')
@Index('idx_agent_memories_agent_status', ['agent', 'status'])
@Index('idx_agent_memories_embedding_status', ['embeddingStatus'])
export class AgentMemory extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', enum: AgentMemoryAgent })
  agent!: AgentMemoryAgent;

  /** The lesson itself. ≤ AGENT_MEMORY_BODY_MAX, enforced by CHECK and by the service. */
  @Column({ type: 'text' })
  body!: string;

  /** Repos this applies to. Null or empty means platform-wide. */
  @Column({ type: 'jsonb', nullable: true })
  repos?: string[] | null;

  /** Open labels — `verification`, `flaky-test`, `fix-gotcha`, whatever emerges. Never a closed list. */
  @Column({ type: 'jsonb', nullable: true })
  tags?: string[] | null;

  @Column({
    type: 'varchar',
    enum: AgentMemoryStatus,
    default: AgentMemoryStatus.ACTIVE,
  })
  status!: AgentMemoryStatus;

  /** Pinned by a person: the curator may never edit or retire it. */
  @Column({ type: 'boolean', default: false })
  pinned!: boolean;

  /** How many separate runs independently produced this lesson. */
  @Column({ name: 'source_count', type: 'int', default: 1 })
  sourceCount!: number;

  /** Times a run said this entry changed what it did. */
  @Column({ name: 'times_applied', type: 'int', default: 0 })
  timesApplied!: number;

  /** Times a run hit the problem this entry warns about anyway. */
  @Column({ name: 'times_contradicted', type: 'int', default: 0 })
  timesContradicted!: number;

  @Column({ name: 'merged_into_id', type: 'uuid', nullable: true })
  mergedIntoId?: string | null;

  // ── provenance ──────────────────────────────────────────────────────────────

  /** The run whose reflection wrote this. Null for a human entry. */
  @Column({ name: 'run_id', type: 'uuid', nullable: true })
  runId?: string | null;

  /** The finding this was learned from, when there was one. */
  @Column({ name: 'finding_id', type: 'uuid', nullable: true })
  findingId?: string | null;

  /** The admin who wrote or last edited it. Integer users.id with NO foreign key, per ally-be convention. */
  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy?: number | null;

  @Column({ name: 'last_applied_at', type: 'timestamp', nullable: true })
  lastAppliedAt?: Date | null;

  // ── derived-index reconciliation (see RoadmapOpportunity) ─────────────────

  @Column({
    name: 'embedding_status',
    type: 'varchar',
    enum: AgentMemoryEmbeddingStatus,
    default: AgentMemoryEmbeddingStatus.PENDING,
  })
  embeddingStatus!: AgentMemoryEmbeddingStatus;

  @Column({ name: 'embedding_attempts', type: 'int', default: 0 })
  embeddingAttempts!: number;

  @Column({ name: 'embedded_at', type: 'timestamp', nullable: true })
  embeddedAt?: Date | null;

  /** SHA-256 of the body as last embedded; a mismatch means the vector is stale. */
  @Column({ name: 'text_hash', type: 'text', nullable: true })
  textHash?: string | null;
}
