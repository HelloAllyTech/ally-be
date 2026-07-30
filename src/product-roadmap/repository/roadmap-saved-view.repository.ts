import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { RoadmapSavedView } from '../entity/roadmap-saved-view.entity';

@Injectable()
export class RoadmapSavedViewRepository extends Repository<RoadmapSavedView> {
  constructor(private readonly dataSource: DataSource) {
    super(RoadmapSavedView, dataSource.createEntityManager());
  }

  /**
   * Views visible to one caller: their own, plus every pinned view.
   *
   * ⚠️ THIS WHERE CLAUSE IS THE AUTHORISATION. In the standalone app it was an RLS policy
   * (`created_by = auth.uid() OR pinned = true`) applied by Postgres to every SELECT. Ally has
   * no RLS, so it has to be here — it is the one rule in this module with no decorator
   * equivalent, because it is a per-ROW read filter rather than a per-endpoint check.
   *
   * Replacing this with a plain find() silently exposes every user's private saved views, with
   * no error and no failing type check. There is a test asserting a third party's unpinned view
   * is never returned; keep it.
   *
   * Pinned views sort first, matching the frontend's tab order.
   */
  async findVisibleTo(userId: number): Promise<RoadmapSavedView[]> {
    return this.createQueryBuilder('v')
      .where('v."deletedAt" IS NULL')
      .andWhere('(v."createdBy" = :userId OR v."pinned" = true)', { userId })
      .orderBy('v."pinned"', 'DESC')
      .addOrderBy('v."createdAt"', 'ASC')
      .getMany();
  }
}
