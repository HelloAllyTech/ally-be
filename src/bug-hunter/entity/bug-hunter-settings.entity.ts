import { Column, Entity, PrimaryColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * The bug-hunter kill switch. A SINGLETON row — `id` is pinned to 1 by a CHECK
 * constraint in the introducing migration, which is what makes "read the
 * settings" a `findOne()` with no WHERE clause rather than a query over a
 * table that could theoretically hold zero or many rows.
 *
 * `enabled` defaults to `false`. Both trigger paths (nightly cron, on-demand)
 * read this before doing anything else — see BugHunterService.checkEnabled.
 * There is no separate "pause vs. disable" state: off means off for every
 * trigger, which is the whole point of a kill switch a SUPER_DUPER_ADMIN can
 * trust at a glance.
 */
@Entity('bug_hunter_settings')
export class BugHunterSettings extends BaseWithoutTenantEntity {
  @PrimaryColumn({ type: 'smallint', default: 1 })
  id!: number;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  /** Integer users.id with NO foreign key, per ally-be convention. Null until the first toggle. */
  @Column({ type: 'int', nullable: true })
  updatedBy?: number | null;
}
