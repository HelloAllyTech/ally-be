import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { RoadmapProductGoal } from '../entity/roadmap-product-goal.entity';
import { RoadmapOpportunityOwner } from '../entity/roadmap-opportunity-owner.entity';

@Injectable()
export class RoadmapProductGoalRepository extends Repository<RoadmapProductGoal> {
  constructor(private readonly dataSource: DataSource) {
    super(RoadmapProductGoal, dataSource.createEntityManager());
  }

  findAllOrdered(): Promise<RoadmapProductGoal[]> {
    return this.find({ order: { position: 'ASC', name: 'ASC' } });
  }

  /**
   * How many live opportunities reference this goal by name. Used to answer 409 instead of
   * letting the FK's ON DELETE RESTRICT surface as a 500.
   */
  async countUsage(name: string): Promise<number> {
    const rows = await this.dataSource.query<{ count: string }[]>(
      `SELECT COUNT(*) AS count FROM roadmap_opportunities
        WHERE "productGoal" = $1 AND "deletedAt" IS NULL`,
      [name],
    );
    return Number(rows[0]?.count ?? 0);
  }
}

@Injectable()
export class RoadmapOpportunityOwnerRepository extends Repository<RoadmapOpportunityOwner> {
  constructor(private readonly dataSource: DataSource) {
    super(RoadmapOpportunityOwner, dataSource.createEntityManager());
  }

  findAllOrdered(): Promise<RoadmapOpportunityOwner[]> {
    return this.find({ order: { position: 'ASC', name: 'ASC' } });
  }

  /**
   * Opportunities currently assigned to this owner. Deleting the owner does NOT block — the FK
   * is ON DELETE SET NULL — so this is shown as a warning ("will un-assign N opportunities"),
   * not an error.
   */
  async countUsage(name: string): Promise<number> {
    const rows = await this.dataSource.query<{ count: string }[]>(
      `SELECT COUNT(*) AS count FROM roadmap_opportunities
        WHERE "owner" = $1 AND "deletedAt" IS NULL`,
      [name],
    );
    return Number(rows[0]?.count ?? 0);
  }
}
