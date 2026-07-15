import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { RoleplaySpecVersionStatus } from '../enum/roleplay-spec-version-status.enum';
import { RoleplaySpecVersionSource } from '../enum/roleplay-spec-version-source.enum';
import { RoleplaySpecDocument } from '../type/roleplay-spec-document.type';

/**
 * An immutable snapshot of a spec's draft document.
 *
 * Snapshots are append-only: one is written for every draft mutation (manual
 * save, copilot patch, explicit checkpoint), so copilot SSE events and room
 * metadata can always point at a stable `specVersionId`. Publish validates a
 * snapshot, applies the rehearsal gate, then flips it PUBLISHED (archiving the
 * previously published one). `versionNumber` is monotonic per spec and never
 * reused.
 */
@Entity('roleplay_spec_versions')
@Index('idx_roleplay_spec_versions_spec_id', ['specId'], {
  where: '"deletedAt" IS NULL',
})
@Index(
  'idx_roleplay_spec_versions_spec_id_version',
  ['specId', 'versionNumber'],
  {
    unique: true,
    where: '"deletedAt" IS NULL',
  },
)
export class RoleplaySpecVersion extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  specId!: string;

  @Column({ type: 'int' })
  versionNumber!: number;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  spec!: Partial<RoleplaySpecDocument>;

  @Column({
    enum: RoleplaySpecVersionStatus,
    default: RoleplaySpecVersionStatus.DRAFT,
  })
  status!: RoleplaySpecVersionStatus;

  // What produced this snapshot (manual_edit / copilot_patch / snapshot).
  @Column({
    enum: RoleplaySpecVersionSource,
    default: RoleplaySpecVersionSource.SNAPSHOT,
  })
  source!: RoleplaySpecVersionSource;

  // For source=copilot_patch: the patchId emitted on the spec_patch SSE frame.
  @Column({ type: 'uuid', nullable: true })
  patchId?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  publishedAt?: Date | null;

  @Column({ type: 'int' })
  createdBy!: number;

  @Column({ type: 'int' })
  updatedBy!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
