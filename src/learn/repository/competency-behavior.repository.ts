import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { CompetencyBehavior } from '../entity/competency-behavior.entity';
import { Behavior } from '../entity/behavior.entity';
import { CompetencyBehaviorType } from '../enum/competency-behavior.enum';

export interface CompetencyBehaviorRow {
  id: string;
  name: string;
  type: CompetencyBehaviorType;
}

@Injectable()
export class CompetencyBehaviorRepository extends Repository<CompetencyBehavior> {
  constructor(private dataSource: DataSource) {
    super(CompetencyBehavior, dataSource.createEntityManager());
  }

  /**
   * Returns the mapped behaviours (joined with the behaviours library for the
   * display name) for a competency.
   */
  async getBehavioursForCompetency(
    competencyId: string,
  ): Promise<CompetencyBehaviorRow[]> {
    return this.createQueryBuilder('cb')
      .innerJoin(Behavior, 'b', 'b.id = cb.behaviorId')
      .where('cb.competencyId = :competencyId', { competencyId })
      .select(['b.id AS id', 'b.name AS name', 'cb.type AS type'])
      .orderBy('b.name', 'ASC')
      .getRawMany<CompetencyBehaviorRow>();
  }

  /**
   * Replaces the full set of behaviour mappings for a competency.
   */
  async replaceForCompetency(
    competencyId: string,
    items: { behaviorId: string; type: CompetencyBehaviorType }[],
  ): Promise<void> {
    await this.delete({ competencyId });
    if (items.length === 0) return;
    const rows = items.map((item) =>
      this.create({
        competencyId,
        behaviorId: item.behaviorId,
        type: item.type,
      }),
    );
    await this.save(rows);
  }

  /**
   * Adds behaviour mappings for a competency, ignoring rows that already exist
   * (ON CONFLICT DO NOTHING on the (competencyId, behaviorId) unique key).
   * Used by the on-read preset seeding so concurrent first reads can't collide.
   */
  async addBehavioursIgnoreConflicts(
    competencyId: string,
    items: { behaviorId: string; type: CompetencyBehaviorType }[],
  ): Promise<void> {
    if (items.length === 0) return;
    await this.createQueryBuilder()
      .insert()
      .values(
        items.map((item) => ({
          competencyId,
          behaviorId: item.behaviorId,
          type: item.type,
        })),
      )
      .orIgnore()
      .execute();
  }
}
