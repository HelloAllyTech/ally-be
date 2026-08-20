import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  CohortContentType,
  COHORT_CONTENT_CONFIG,
} from '../constants/cohort.constants';

export interface RestrictionRow {
  contentId: string;
  cohortId: string | null;
}

/**
 * Reads and replaces cohort restrictions across the three structurally identical
 * restriction tables.
 *
 * Not a `Repository<T>` subclass: it spans three entities, and the table is
 * chosen by content type at call time. It drives every statement off
 * COHORT_CONTENT_CONFIG, so table and column names are never taken from request
 * input — the only untrusted value in play is the content id, which is always
 * bound as a parameter.
 */
@Injectable()
export class CohortRestrictionRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Restrictions for a tenant, optionally narrowed to specific content ids.
   *
   * Content ids come back as strings regardless of the underlying column type so
   * one DTO shape serves scenarios (integer ids) and courses/cases (uuids).
   */
  async findForTenant(
    contentType: CohortContentType,
    tenantId: string,
    contentIds?: string[],
  ): Promise<RestrictionRow[]> {
    const { table, column, idIsUuid } = COHORT_CONTENT_CONFIG[contentType];
    const params: unknown[] = [tenantId];
    let filter = '';

    if (contentIds && contentIds.length > 0) {
      params.push(contentIds);
      filter = `AND "${column}" = ANY($2::${idIsUuid ? 'uuid' : 'int'}[])`;
    }

    const rows = await this.dataSource.query(
      `SELECT "${column}"::text AS "contentId", "cohortId"
         FROM "${table}"
        WHERE "tenantId" = $1 AND "deletedAt" IS NULL ${filter}`,
      params,
    );
    return rows as RestrictionRow[];
  }

  /**
   * Replaces the restriction set for one content item with exactly `cohortIds`
   * (a null entry meaning the Unassigned bucket). An empty list clears every
   * restriction, returning the item to tenant-wide visibility.
   *
   * Hard `DELETE` of the previous set, not a soft delete. These rows carry no
   * history anyone reads, and soft-deleting them would leave the partial unique
   * indexes to accumulate tombstones that make re-adding the same cohort depend
   * on whether it was ever removed before. `deletedAt` stays on the table only
   * so the read path's `IS NULL` predicate is stable if that ever changes.
   */
  async replaceForContent(
    contentType: CohortContentType,
    tenantId: string,
    contentId: string,
    cohortIds: Array<string | null>,
    manager?: EntityManager,
  ): Promise<void> {
    const { table, column, idIsUuid } = COHORT_CONTENT_CONFIG[contentType];
    const cast = idIsUuid ? '::uuid' : '::int';
    const runner = manager ?? this.dataSource.manager;

    await runner.query(
      `DELETE FROM "${table}" WHERE "tenantId" = $1 AND "${column}" = $2${cast}`,
      [tenantId, contentId],
    );

    if (cohortIds.length === 0) return;

    // De-duplicate so a body listing the same cohort twice is accepted rather
    // than tripping the unique index.
    const unique = Array.from(new Set(cohortIds));
    const values = unique
      .map((_, i) => `($1, $2${cast}, $${i + 3}::uuid)`)
      .join(', ');

    await runner.query(
      `INSERT INTO "${table}" ("tenantId", "${column}", "cohortId")
       VALUES ${values}`,
      [tenantId, contentId, ...unique],
    );
  }

  /**
   * Drops every restriction pointing at a cohort that is being deleted, in the
   * same transaction as the deletion.
   *
   * Without this, deleting a cohort would leave content restricted to an
   * audience that no longer exists — visible to nobody, and invisible in the UI
   * because the cohort is gone. The ON DELETE CASCADE on the FK covers a hard
   * row delete; cohorts are soft-deleted, so this does the work explicitly.
   */
  async deleteByCohort(
    cohortId: string,
    manager: EntityManager,
  ): Promise<void> {
    for (const { table } of Object.values(COHORT_CONTENT_CONFIG)) {
      await manager.query(`DELETE FROM "${table}" WHERE "cohortId" = $1`, [
        cohortId,
      ]);
    }
  }
}
