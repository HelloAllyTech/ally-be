import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { BuilderPrdVersionAuthor } from '../enum/builder.enum';
import { BuilderPrdDocument } from '../type/builder-prd.type';

/**
 * Immutable PRD snapshot, one per mutation. Append-only: a build run pins the
 * exact document it was dispatched with, and "who changed this requirement,
 * the agent or me?" is answerable months later.
 */
@Entity('builder_prd_versions')
@Index('idx_builder_prd_versions_doc_version', ['docId', 'versionNumber'], {
  unique: true,
})
export class BuilderPrdVersion extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  docId!: string;

  @Column({ type: 'int' })
  versionNumber!: number;

  @Column({ type: 'jsonb' })
  content!: BuilderPrdDocument;

  @Column({ enum: BuilderPrdVersionAuthor })
  author!: BuilderPrdVersionAuthor;

  /** One line on what moved — shown in the version list. */
  @Column({ type: 'text', nullable: true })
  changeSummary?: string | null;

  @Column({ type: 'int', nullable: true })
  createdBy?: number;
}
