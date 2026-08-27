import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * Supabase `app_users.id` (uuid) → Ally `users.id` (int), written by the one-off import
 * script (src/database/scripts/import-roadmap-from-supabase.ts).
 *
 * A REAL table rather than a temp one, for two reasons: a re-run or a delta extract must
 * reproduce identical ids, and this doubles as the permanent decision log of which Ally users
 * the import created (`createdByMigration`) — the one thing the migration's down() cannot
 * safely undo, since deleting users could orphan anything else that referenced them
 * meanwhile.
 *
 * `sourceEmailLower` is UNIQUE and that is load-bearing. Ally lowercases emails, so two
 * source accounts differing only in case would map to one Ally user; because
 * roadmap_allocations is unique on (userId, opportunityId, periodKey), their votes on the
 * same opportunity in the same month would MERGE into one row — votes would silently vanish
 * and the ≤100 cap could be breached. The constraint turns that into a loud failure inside
 * the import transaction instead.
 *
 * `sourceRole` ('admin' | 'user') is retained for audit only. Roadmap access in Ally comes
 * from the three product-roadmap permissions, granted through group/role admin.
 */
@Entity('roadmap_user_map')
@Index('idx_roadmap_user_map_ally_user', ['allyUserId'])
export class RoadmapUserMap extends BaseWithoutTenantEntity {
  @PrimaryColumn({ type: 'uuid' })
  sourceUserId!: string;

  @Column({ type: 'varchar' })
  sourceEmail!: string;

  @Column({ type: 'varchar', unique: true })
  sourceEmailLower!: string;

  @Column({ type: 'varchar' })
  sourceRole!: string;

  @Column({ type: 'int' })
  allyUserId!: number;

  /** True when the import created this Ally user rather than matching an existing one. */
  @Column({ type: 'boolean', default: false })
  createdByMigration!: boolean;
}
