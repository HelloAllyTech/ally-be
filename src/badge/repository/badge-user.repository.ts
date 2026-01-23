import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { BadgeUser } from '../entity/badge-user.entity';
import { User } from 'src/user/entity/user.entity';

@Injectable()
export class BadgeUserRepository extends Repository<BadgeUser> {
  constructor(private dataSource: DataSource) {
    super(BadgeUser, dataSource.createEntityManager());
  }

  async findBadgeUserIdsByTenants(
    badgeId: string,
    tenantIds: string[],
  ): Promise<string[]> {
    const badgeUsers = await this.createQueryBuilder('badgeUser')
      .innerJoin(User, 'user', 'user.id = badgeUser.userId')
      .where('badgeUser.badgeId = :badgeId', { badgeId })
      .andWhere('user.tenantId IN (:...tenantIds)', { tenantIds })
      .andWhere('badgeUser.deletedAt IS NULL')
      .select('badgeUser.id')
      .getMany();

    return badgeUsers.map((badgeUser) => badgeUser.id);
  }
}
