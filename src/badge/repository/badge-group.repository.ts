import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { BadgeGroup } from '../entity/badge-group.entity';
import { Group } from 'src/authorization/entity/group.entity';

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

  /**
   * Returns group names (roles) per badgeId by joining badge_groups and groups.
   * BadgeIds with no associated groups are omitted.
   */
  async getGroupNamesByBadgeIds(
    badgeIds: string[],
  ): Promise<Map<string, string[]>> {
    if (badgeIds.length === 0) {
      return new Map();
    }

    const rows = await this.createQueryBuilder('badgeGroup')
      .innerJoin(Group, 'group', 'group.id = badgeGroup.groupId')
      .where('badgeGroup.badgeId IN (:...badgeIds)', { badgeIds })
      .andWhere('badgeGroup.deletedAt IS NULL')
      .select('badgeGroup.badgeId', 'badgeId')
      .addSelect('group.name', 'name')
      .getRawMany<{ badgeId: string; name: string }>();

    const groupNamesByBadgeId = new Map<string, string[]>();
    for (const { badgeId, name: groupName } of rows) {
      const groupNamesForBadge = groupNamesByBadgeId.get(badgeId) ?? [];
      groupNamesForBadge.push(groupName);
      groupNamesByBadgeId.set(badgeId, groupNamesForBadge);
    }
    return groupNamesByBadgeId;
  }
}
