import { Column, Entity, PrimaryColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * The four composite-rank factor weights. A SINGLETON — `id` is pinned to 1 by a CHECK, so
 * "there is exactly one weight set" is a database guarantee rather than a convention a second
 * insert could quietly break.
 *
 * Stored as small non-negative integers and normalised to sum 1 at read time, so an admin can
 * express "votes and breadth matter three times as much as size" by typing 3/3/1/3 without
 * doing the arithmetic. A CHECK rejects an all-zero set, which would otherwise divide by zero
 * in the ranking SQL.
 *
 * WHY A TABLE RATHER THAN THE PREFERENCE RECIPE. The per-tenant Preference pattern does not
 * apply here: the roadmap is a global internal surface with no tenant, and these numbers are
 * read by the list query on every single board load — a row the query can join is cheaper and
 * more honest than a key-value lookup.
 *
 * Changing a weight costs NOTHING but a re-sort: weights are applied in SQL over factors that
 * are already stored or already aggregates, so recalibrating never re-runs the LLM. That is the
 * property that makes them safe to expose as a live settings control instead of a deploy.
 *
 * DEFAULTS: 3 / 3 / 1 / 3. Effort starts low on purpose. It is an INVERSE factor (cheaper ranks
 * higher), so weighting it heavily surfaces trivial work above hard, high-conviction work — the
 * classic quick-wins bias. At 1 it breaks ties between comparable opportunities rather than
 * driving the order, and an admin who wants a cheap-first board can raise it.
 */
@Entity('roadmap_rank_weights')
export class RoadmapRankWeights extends BaseWithoutTenantEntity {
  /** Always 1. Enforced by CHK_roadmap_rank_weights_singleton. */
  @PrimaryColumn({ type: 'int', default: 1 })
  id!: number;

  /** SUM(votes) — how much total conviction the board has spent on this. */
  @Column({ type: 'int', default: 3 })
  votesWeight!: number;

  /** COUNT(DISTINCT voter) — how many admins independently backed it. Breadth, not intensity. */
  @Column({ type: 'int', default: 3 })
  votersWeight!: number;

  /** Shirt size, INVERSE: S scores highest, XXL lowest, unsized sits at the middle. */
  @Column({ type: 'int', default: 1 })
  effortWeight!: number;

  /** Share of strategy goals the LLM judged this opportunity positively moves. */
  @Column({ type: 'int', default: 3 })
  goalImpactWeight!: number;
}
