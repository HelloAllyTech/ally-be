import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Public-facing changelog / release-note entries. Rows are appended by the
 * `ally-changelog` repo's `append-entry.yml` GitHub Action on every merge
 * across the platform's repos (see ChangelogController) and read publicly by
 * the helpline dashboard's `/blog/changelog` page. Deliberately not the same
 * as `RoadmapReleaseNote` (internal roadmap release notes) or `Blog`
 * (long-form authored posts) — this is a flat, append-only feed of one entry
 * per merged PR.
 */
@Entity('changelog_entries')
export class ChangelogEntry extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  repo!: string;

  @Column({ type: 'text' })
  releaseNoteText!: string;

  // Indexed since the public list endpoint always orders by this descending.
  @Index('idx_changelog_entries_merged_at')
  @Column({ type: 'timestamptz' })
  mergedAt!: Date;
}
