import { Injectable } from '@nestjs/common';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { KbDocumentTenant } from '../entity/kb-document-tenant.entity';

@Injectable()
export class KbDocumentTenantRepository extends Repository<KbDocumentTenant> {
  constructor(private readonly dataSource: DataSource) {
    super(KbDocumentTenant, dataSource.createEntityManager());
  }

  /**
   * Organisation ids per document, for a page of documents.
   *
   * One query for the whole page rather than one per row: the corpus table renders an
   * organisations cell on every line, and a per-row lookup would be N+1 on a list that already
   * pages at 25.
   */
  async tenantIdsByDocument(
    documentIds: string[],
  ): Promise<Map<string, string[]>> {
    const byDocument = new Map<string, string[]>();
    if (!documentIds.length) return byDocument;

    const rows = await this.find({
      where: { documentId: In(documentIds), deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });

    for (const row of rows) {
      const existing = byDocument.get(row.documentId);
      if (existing) existing.push(row.tenantId);
      else byDocument.set(row.documentId, [row.tenantId]);
    }
    return byDocument;
  }

  async tenantIdsForDocument(documentId: string): Promise<string[]> {
    return (await this.tenantIdsByDocument([documentId])).get(documentId) ?? [];
  }

  /**
   * Make the document's organisations exactly `tenantIds`, returning what changed.
   *
   * SOFT-DELETE THEN INSERT, in that order, inside ONE transaction. The order matters because the
   * unique index is partial on `deletedAt IS NULL`: re-granting an organisation in the same call
   * that removes it would collide if the insert went first. One transaction matters because the
   * half-applied state — access removed, replacement not yet granted — is a window in which a
   * worker gets told the corpus does not cover their question.
   *
   * Returns the added and removed ids so the caller can decide whether the vector index needs
   * touching at all: an admin who opens the panel and saves without changing anything should not
   * trigger a sweep over every chunk of a 300-page book.
   */
  async replaceForDocument(
    documentId: string,
    tenantIds: string[],
  ): Promise<{ added: string[]; removed: string[]; tenantIds: string[] }> {
    const desired = [...new Set(tenantIds.map((id) => id.trim()))].filter(
      Boolean,
    );

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(KbDocumentTenant);

      const current = await repository.find({
        where: { documentId, deletedAt: IsNull() },
      });
      const currentIds = new Set(current.map((row) => row.tenantId));
      const desiredIds = new Set(desired);

      const removed = [...currentIds].filter((id) => !desiredIds.has(id));
      const added = desired.filter((id) => !currentIds.has(id));

      if (removed.length) {
        await repository.softDelete({
          documentId,
          tenantId: In(removed),
        });
      }
      if (added.length) {
        await repository.insert(
          added.map((tenantId) => ({ documentId, tenantId })),
        );
      }

      return { added, removed, tenantIds: desired };
    });
  }

  /** Every document targeted at one organisation. Backs the corpus list's organisation filter. */
  async documentIdsForTenant(tenantId: string): Promise<string[]> {
    const rows = await this.find({
      where: { tenantId, deletedAt: IsNull() },
      select: ['documentId'],
    });
    return [...new Set(rows.map((row) => row.documentId))];
  }
}
