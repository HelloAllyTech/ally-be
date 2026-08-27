import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * One user's votes on one opportunity in one calendar month. This table IS the priority
 * signal — everything else on the board is metadata around it.
 *
 * Invariants, and where each is enforced:
 *
 *  - SUM(votes) per (userId, periodKey) ≤ 100 — a cross-row invariant, so it lives in the
 *    trigger roadmap_enforce_monthly_cap() (migration 1871000000001, renamed onto this column
 *    by 1940700000000) PLUS a pg_advisory_xact_lock in RoadmapAllocationService. Neither
 *    layer alone is sufficient: a CHECK cannot see other rows, and a service-only
 *    read-then-write races under READ COMMITTED.
 *  - 0 ≤ votes ≤ 100 — CHECK constraint. Note the trigger does NOT catch a negative value
 *    (0 + -5 is under the cap), so this CHECK is the only guard there.
 *  - periodKey matches ^[0-9]{4}-(0[1-9]|1[0-2])$ — CHECK constraint.
 *  - votes may only be cast on a stage=new opportunity — service-level, because split/merge
 *    must redistribute votes on opportunities that have already moved on. In the source this
 *    was a trigger that split/merge defeated with a transaction-local GUC
 *    (app.bypass_stage_check); that hack is gone.
 *
 * NO soft delete: setting votes to 0 deletes the row. A soft-deleted allocation would still
 * have to be excluded from every SUM, which is a footgun on the one number that matters —
 * so uniqueness is a real UNIQUE constraint rather than a partial index.
 *
 * periodKey is always computed SERVER-side and never accepted from the client. The source's
 * RLS allowed a write to any period_key, and since the score sums all periods forever that
 * was unbounded score inflation; it also used browser-local time, so a tab left open across
 * midnight on the 1st voted into the previous month.
 */
@Entity('roadmap_allocations')
@Unique('UQ_roadmap_allocations_user_opp_period', [
  'userId',
  'opportunityId',
  'periodKey',
])
// The priority-score aggregate: SUM(votes) GROUP BY "opportunityId".
@Index('idx_roadmap_allocations_opportunity', ['opportunityId'])
// The monthly-cap lookup.
@Index('idx_roadmap_allocations_user_period', ['userId', 'periodKey'])
@Index('idx_roadmap_allocations_period', ['periodKey'])
export class RoadmapAllocation extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Ally users.id. Integer, no FK, per convention. */
  @Column({ type: 'int' })
  userId!: number;

  @Column({ type: 'uuid' })
  opportunityId!: string;

  /** 'YYYY-MM', computed server-side in UTC. */
  @Column({ type: 'varchar', length: 7 })
  periodKey!: string;

  @Column({ type: 'int' })
  votes!: number;
}
