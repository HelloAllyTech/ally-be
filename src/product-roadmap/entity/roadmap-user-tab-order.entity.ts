import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * One row per user: the order they have dragged their saved-view tabs into.
 *
 * `viewIds` is intentionally tolerant — it may reference views that have since been deleted,
 * and may omit views created after it was written. The frontend's applySavedViewOrder skips
 * unknown ids and appends missing views in natural order, so a stale array degrades to a
 * slightly-wrong order rather than a hidden tab. Never treat it as authoritative membership.
 *
 * Surrogate uuid PK with a UNIQUE userId (rather than userId as the PK) so the entity follows
 * ally-be's @PrimaryGeneratedColumn('uuid') convention.
 */
@Entity('roadmap_user_tab_order')
export class RoadmapUserTabOrder extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int', unique: true })
  userId!: number;

  @Column({ type: 'uuid', array: true, default: () => `'{}'` })
  viewIds!: string[];
}
