import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * A published set of release notes: a manager picks released opportunities, an LLM drafts
 * categorised notes from them, the manager edits, and this row is saved.
 *
 * `opportunityIds` is a DENORMALISED uuid[] snapshot, not a join table — deliberately, and
 * carried over from the source. A release note records what it was generated from at that
 * moment; it must keep rendering even after the taxonomy moves on, an opportunity is merged
 * away, or a stage changes. Because opportunities are soft-deleted here (the source
 * hard-deleted them), those ids stay resolvable rather than dangling — a genuine improvement
 * on the source, not an accident.
 *
 * Read access is gated on view:admin:product-roadmap and write on edit:. That read gate is a
 * deliberate divergence: the source used RLS so a non-admin SELECT returned zero rows rather
 * than an error, and its client relied on that; gating reads on edit: would 403 where the
 * client expects an empty list.
 */
@Entity('roadmap_release_notes')
@Index('idx_roadmap_release_notes_created_at', ['createdAt'], {
  where: '"deletedAt" IS NULL',
})
export class RoadmapReleaseNote extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', nullable: true })
  title?: string | null;

  /** Plain text / markdown, ≤20000 chars. Not HTML — the LLM generates this field. */
  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'uuid', array: true, default: () => `'{}'` })
  opportunityIds!: string[];

  @Column({ type: 'int' })
  createdBy!: number;

  @Column({ type: 'int' })
  updatedBy!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
