import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { RoadmapSavedViewState } from '../type/roadmap-saved-view.type';

/**
 * A named snapshot of the board's filters and sort, rendered as a sub-tab. Each user keeps
 * their own; a manager can PIN one so it appears for everyone.
 *
 * READ VISIBILITY IS ROW-LEVEL: a caller sees their own views plus every pinned view, and
 * must never see another user's unpinned view. In the source that was an RLS policy
 * (`created_by = auth.uid() OR pinned = true`); here it has to be a WHERE clause in the
 * repository. It is the one rule with no decorator equivalent, it is easy to forget, and
 * forgetting it silently over-shares. There is a test for it.
 *
 * `pinned` is only settable through the dedicated pin endpoint, gated on
 * edit:admin:product-roadmap — a plain PATCH must reject the field. That replaces the
 * source's enforce_pin_admin() trigger, which existed only because RLS let a creator update
 * their own row including `pinned`.
 */
@Entity('roadmap_saved_views')
@Index('idx_roadmap_saved_views_created_by', ['createdBy'], {
  where: '"deletedAt" IS NULL',
})
@Index('idx_roadmap_saved_views_pinned', ['pinned'], {
  where: '"pinned" = true AND "deletedAt" IS NULL',
})
export class RoadmapSavedView extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  state!: RoadmapSavedViewState;

  @Column({ type: 'boolean', default: false })
  pinned!: boolean;

  @Column({ type: 'int' })
  createdBy!: number;

  @Column({ type: 'int' })
  updatedBy!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
