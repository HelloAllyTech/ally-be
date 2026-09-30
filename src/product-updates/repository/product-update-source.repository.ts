import { Injectable } from '@nestjs/common';
import { DataSource, In, LessThanOrEqual, Repository } from 'typeorm';

import {
  ProductUpdateSource,
  ProductUpdateSourceStatus,
} from '../entity/product-update-source.entity';

@Injectable()
export class ProductUpdateSourceRepository extends Repository<ProductUpdateSource> {
  constructor(private readonly dataSource: DataSource) {
    super(ProductUpdateSource, dataSource.createEntityManager());
  }

  async knownJournalIds(journalIds: string[]): Promise<Set<string>> {
    if (journalIds.length === 0) return new Set();
    const rows = await this.find({
      select: { journalId: true },
      where: { journalId: In(journalIds) },
    });
    return new Set(rows.map((row) => row.journalId));
  }

  /** Oldest first, so a backlog is worked through in the order it happened. */
  async findByStatus(
    status: ProductUpdateSourceStatus,
    params: { limit: number; mergedBefore?: Date },
  ): Promise<ProductUpdateSource[]> {
    return this.find({
      where: {
        status,
        ...(params.mergedBefore
          ? { mergedAt: LessThanOrEqual(params.mergedBefore) }
          : {}),
      },
      order: { mergedAt: 'ASC', id: 'ASC' },
      take: params.limit,
    });
  }

  async countByStatus(): Promise<Record<ProductUpdateSourceStatus, number>> {
    const rows: { status: ProductUpdateSourceStatus; count: string }[] =
      await this.createQueryBuilder('s')
        .select('s.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('s.status')
        .getRawMany();
    const counts = {
      [ProductUpdateSourceStatus.PENDING]: 0,
      [ProductUpdateSourceStatus.ENRICHED]: 0,
      [ProductUpdateSourceStatus.CONSOLIDATED]: 0,
      [ProductUpdateSourceStatus.NOISE]: 0,
    };
    for (const row of rows) counts[row.status] = Number(row.count);
    return counts;
  }

  /** Noise decided since a moment — the digest's "under the hood" count. */
  async countNoiseSince(since: Date): Promise<number> {
    return this.createQueryBuilder('s')
      .where('s.status = :status', { status: ProductUpdateSourceStatus.NOISE })
      .andWhere('s.consolidatedAt >= :since', { since })
      .getCount();
  }
}
