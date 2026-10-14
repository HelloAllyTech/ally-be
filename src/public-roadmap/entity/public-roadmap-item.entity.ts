import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

import {
  ROADMAP_DESCRIPTION_MAX_LENGTH,
  ROADMAP_NOTE_MAX_LENGTH,
  ROADMAP_TITLE_MAX_LENGTH,
  RoadmapCategory,
  RoadmapStage,
} from '../constants/public-roadmap.constants';

/**
 * One card on the public product roadmap at app.helloally.ai/blog/roadmap: a
 * product or feature, the category it serves (prepare / perform) and how
 * mature it is (idea → stable).
 *
 * Not to be confused with `src/product-roadmap`, the internal opportunity
 * backlog people vote on. This is the outward-facing summary, written by hand.
 *
 * Platform-wide, not tenant-scoped: Ally has one roadmap. Edits go live on
 * save; `isPublic = false` keeps a card off the page while it is being
 * prepared (decided 2026-10-14 — no draft/publish split).
 */
@Entity('public_roadmap_items')
@Index('idx_public_roadmap_items_cell', ['category', 'stage', 'sortOrder'])
export class PublicRoadmapItem extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: ROADMAP_TITLE_MAX_LENGTH })
  title!: string;

  @Column({ type: 'varchar', length: ROADMAP_DESCRIPTION_MAX_LENGTH })
  description!: string;

  /** Optional one-line callout under the description, e.g. "Current priority". */
  @Column({
    type: 'varchar',
    length: ROADMAP_NOTE_MAX_LENGTH,
    nullable: true,
  })
  note!: string | null;

  @Column({ type: 'varchar', length: 16 })
  category!: RoadmapCategory;

  @Column({ type: 'varchar', length: 16 })
  stage!: RoadmapStage;

  /** Position within its category × stage cell, ascending. */
  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder!: number;

  @Column({ name: 'is_public', type: 'boolean', default: true })
  isPublic!: boolean;

  @Column({ name: 'created_by', type: 'integer', nullable: true })
  createdBy!: number | null;

  @Column({ name: 'updated_by', type: 'integer', nullable: true })
  updatedBy!: number | null;
}
