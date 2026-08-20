import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Attachment of a tenant to a language variety profile — the many-to-one
 * org→profile mapping. One active attachment per (tenantId, languageId)
 * (unique index in the migration): an org speaks exactly one variety of a
 * language at a time, and re-inference re-points the attachment rather than
 * stacking rows. Deliberately WITHOUT a tenant-scoped base entity: the row
 * references a tenant but is platform-owned data, like the profiles it joins.
 */
@Entity('variety_profile_attachments')
@Index('idx_variety_attachments_profile', ['profileId'])
export class VarietyProfileAttachment extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  profileId!: string;

  /** tenants.id as text (matching the platform's varchar tenant refs). */
  @Column({ type: 'varchar', length: 255 })
  tenantId!: string;

  @Column({ type: 'int' })
  languageId!: number;

  /** 'inferred' (similarity match / new profile) or 'manual' (admin move). */
  @Column({ type: 'varchar', length: 20, default: 'inferred' })
  attachedBy!: string;

  /** Similarity to the profile at attach time; null for new/manual attaches. */
  @Column({ type: 'float', nullable: true })
  similarity?: number;
}
