import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { BugHuntLookupKind } from '../enum/bug-hunt-telemetry.enum';

/**
 * One fetch of context during one run: what kind, how much came back, how
 * long it took, and — for retrieval that ranks — how relevant it was and how
 * much of it the agent went on to use.
 *
 * This is the "what was the agent shown" half of pipeline telemetry. A finding
 * count on its own cannot tell a thorough night from a noisy one: twelve
 * findings from a sweep that read a 3,000-line diff and forty log clusters is
 * a different result from twelve findings out of a two-file diff and an empty
 * log. These rows, summed per run, are what makes that distinction visible.
 *
 * For the pipeline's own endpoints (prod logs, web errors, reported bugs,
 * approved findings, the known-non-bugs block in the sweep prompt) the row is
 * written by the server as it serves the request — see
 * `BugHunterTelemetryService.timed` — so an agent that simply passes
 * `&runId=` gets measured with no further cooperation. Lookups that happen
 * inside the agent's own tools (a memory search, a repo-map read) arrive via
 * `POST runs/:id/lookups`, which is the only path that can fill
 * `relevance` and `usedCount`, because only the agent knows what it used.
 *
 * `chars` is the response size in characters, kept rather than a token count
 * because it is exact and provider-neutral; divide by four for a rough token
 * figure. `itemCount` is zero for a fetch that returned nothing, which is a
 * real result (a clean log) and is what the hit-rate metric divides by.
 *
 * Never raw content: this table records sizes and scores, not what was said.
 */
@Entity('bug_hunt_context_lookups')
@Index('idx_bug_hunt_context_lookups_run_id', ['runId'])
@Index('idx_bug_hunt_context_lookups_created_at', ['createdAt'])
export class BugHuntContextLookup extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;

  @Column({ type: 'varchar', enum: BugHuntLookupKind })
  kind!: BugHuntLookupKind;

  /** Items returned: log clusters, exceptions, reported bugs, memory entries. Zero is a valid, informative result. */
  @Column({ name: 'item_count', type: 'int', default: 0 })
  itemCount!: number;

  /** Size of what was handed to the agent, in characters. */
  @Column({ type: 'int', default: 0 })
  chars!: number;

  @Column({ name: 'latency_ms', type: 'int', default: 0 })
  latencyMs!: number;

  /** Top relevance score of a ranked lookup, 0-1. Null for endpoints that do not rank. */
  @Column({ type: 'numeric', precision: 5, scale: 4, nullable: true })
  relevance?: string | null;

  /** How many of the returned items the agent reported actually using. Null when it did not say. */
  @Column({ name: 'used_count', type: 'int', nullable: true })
  usedCount?: number | null;

  /** Small structured detail: the query text's length, the repo, a scope. Never the content itself. */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;
}
