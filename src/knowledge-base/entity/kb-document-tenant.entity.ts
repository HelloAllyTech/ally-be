import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One organisation a corpus document is available to.
 *
 * The same shape as `scenario_tenants` / `track_tenants` / `case_tenants`, deliberately: this is
 * the platform's existing answer to "which organisations get this piece of content", and a
 * WhatsApp corpus document is content. Absent rows plus `kb_documents.isGlobal = false` means the
 * document reaches nobody; `isGlobal = true` means every organisation, and these rows are then
 * ignored rather than consulted.
 *
 * SOFT-DELETED rather than removed, matching its three siblings, so "this organisation used to
 * have access" survives in the row history — which matters here because the conversation log
 * keeps citations, and a question about why a worker was once answered from a document their
 * organisation no longer has is answerable only if the removal left a trace.
 */
@Entity('kb_document_tenants')
@Index('uq_kb_document_tenants_document_tenant', ['documentId', 'tenantId'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class KbDocumentTenant extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_kb_document_tenants_document')
  @Column({ type: 'uuid', name: 'document_id' })
  documentId!: string;

  /**
   * `tenants.id` is a uuid, so this is a uuid — unlike `scenario_sessions.tenant_id`, which is a
   * varchar and needs a cast to join. Nothing to cast here.
   */
  @Index('idx_kb_document_tenants_tenant')
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId!: string;

  @DeleteDateColumn()
  deletedAt?: Date;
}
