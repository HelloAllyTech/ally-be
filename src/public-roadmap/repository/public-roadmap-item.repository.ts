import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { PublicRoadmapItem } from '../entity/public-roadmap-item.entity';
import {
  RoadmapCategory,
  RoadmapStage,
} from '../constants/public-roadmap.constants';

@Injectable()
export class PublicRoadmapItemRepository extends Repository<PublicRoadmapItem> {
  constructor(private readonly dataSource: DataSource) {
    super(PublicRoadmapItem, dataSource.createEntityManager());
  }

  /** Every card, or only the visible ones, in cell order. */
  async listOrdered(options: {
    publicOnly: boolean;
  }): Promise<PublicRoadmapItem[]> {
    const qb = this.createQueryBuilder('item');
    if (options.publicOnly) {
      qb.where('item.isPublic = :isPublic', { isPublic: true });
    }
    return qb
      .orderBy('item.sortOrder', 'ASC')
      .addOrderBy('item.createdAt', 'ASC')
      .getMany();
  }

  /** The `sortOrder` that places a card after everything already in its cell. */
  async nextSortOrder(
    category: RoadmapCategory,
    stage: RoadmapStage,
  ): Promise<number> {
    const row = await this.createQueryBuilder('item')
      .select('MAX(item.sortOrder)', 'max')
      .where('item.category = :category AND item.stage = :stage', {
        category,
        stage,
      })
      .getRawOne<{ max: number | null }>();
    return row?.max == null ? 0 : Number(row.max) + 1;
  }
}
