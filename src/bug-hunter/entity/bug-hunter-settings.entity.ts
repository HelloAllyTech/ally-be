import { Column, Entity, PrimaryColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { BugHunterMode } from '../enum/bug-finding.enum';
import {
  DecisionOwner,
  DecisionPoint,
} from '../type/bug-hunter-orchestrator.type';

/**
 * The bug-hunter kill switch. A SINGLETON row — `id` is pinned to 1 by a CHECK
 * constraint in the introducing migration, which is what makes "read the
 * settings" a `findOne()` with no WHERE clause rather than a query over a
 * table that could theoretically hold zero or many rows.
 *
 * `mode` defaults to OFF (migration 1898000000000 replaced the original plain
 * `enabled` boolean with this three-way switch — see BugHunterMode). Both
 * trigger paths (nightly cron, on-demand) read this before doing anything
 * else — see BugHunterService.checkEnabled. OFF still means off for every
 * trigger, exactly as before; MANUAL and AI both let discovery run and differ
 * only in whether the fix stage needs an admin's approval first.
 */
@Entity('bug_hunter_settings')
export class BugHunterSettings extends BaseWithoutTenantEntity {
  @PrimaryColumn({ type: 'smallint', default: 1 })
  id!: number;

  @Column({ enum: BugHunterMode, default: BugHunterMode.OFF })
  mode!: BugHunterMode;

  /** Integer users.id with NO foreign key, per ally-be convention. Null until the first toggle. */
  @Column({ type: 'int', nullable: true })
  updatedBy?: number | null;

  /**
   * Per-point decision ownership (OPP-0783): D1..D8 → 'rule' | 'model'.
   * Null or an absent point means `BUG_HUNTER_DECISION_OWNER_DEFAULTS`.
   * D4 and D8 are fixed in code and ignore this.
   */
  @Column({ name: 'decision_owners', type: 'jsonb', nullable: true })
  decisionOwners?: Partial<Record<DecisionPoint, DecisionOwner>> | null;
}
