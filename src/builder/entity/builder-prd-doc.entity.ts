import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { BuilderPrdDocument } from '../type/builder-prd.type';

/**
 * The living PRD for a session: one mutable `draft` plus an append-only trail
 * of builder_prd_versions snapshots (the RoleplaySpec draft/version pair).
 *
 * Both the agent (update_prd, RFC-6902 patches) and the admin (direct section
 * edits) mutate the same draft, which is why every mutation snapshots — the
 * version history is the only way to tell who changed what after the fact.
 */
@Entity('builder_prd_docs')
export class BuilderPrdDoc extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_builder_prd_docs_session_id', { unique: true })
  @Column({ type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'jsonb' })
  draft!: BuilderPrdDocument;

  /** Newest snapshot number; the next version is this + 1. */
  @Column({ type: 'int', default: 0 })
  versionNumber!: number;

  @Column({ type: 'int', nullable: true })
  updatedBy?: number;
}
