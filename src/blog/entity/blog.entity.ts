import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { BlogStatus } from '../enum/blog-status.enum';

/**
 * Platform-wide blog posts (release announcements & product updates). These are
 * global content authored by super-admins — not tenant scoped — so the entity
 * extends BaseWithoutTenantEntity. Published posts are served publicly (no auth)
 * on app.helloally.ai/blog; drafts are only visible to super-admins.
 */
@Entity('blogs')
export class Blog extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  // URL-friendly identifier used for the public post route (/blog/:slug).
  @Index('uq_blogs_slug_idx', { unique: true, where: '"deletedAt" IS NULL' })
  @Column({ type: 'varchar', length: 280 })
  slug!: string;

  // Short "too long; didn't read" summary shown in listings.
  @Column({ type: 'text', nullable: true })
  tldr?: string | null;

  // Rich-text HTML body (sanitized on write).
  @Column({ type: 'text', nullable: true })
  body?: string | null;

  // Free-form tags for filtering/discovery.
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  tags!: string[];

  @Column({ type: 'varchar', length: 120, nullable: true })
  category?: string | null;

  // Display name of the post's author (free-form; distinct from created_by which
  // references the super-admin user who authored the record).
  @Column({ type: 'varchar', name: 'author_name', length: 120, nullable: true })
  authorName?: string | null;

  @Column({ type: 'text', name: 'header_image_url', nullable: true })
  headerImageUrl?: string | null;

  @Column({ type: 'varchar', length: 20, default: BlogStatus.DRAFT })
  status!: BlogStatus;

  // Set the first time a post transitions to PUBLISHED; cleared on unpublish.
  @Column({ name: 'published_at', type: 'timestamp', nullable: true })
  publishedAt?: Date | null;

  @Column({ name: 'created_by', type: 'int' })
  createdBy!: number;

  @Column({ name: 'updated_by', type: 'int' })
  updatedBy!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
