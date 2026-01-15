import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { BadgeGroup } from '../entity/badge-group.entity';

@Injectable()
export class BadgeGroupRepository extends Repository<BadgeGroup> {
  constructor(private dataSource: DataSource) {
    super(BadgeGroup, dataSource.createEntityManager());
  }

  async findByBadgeId(badgeId: string): Promise<BadgeGroup[]> {
    return this.find({
      where: { badgeId },
    });
  }
}
