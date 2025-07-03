import { InjectRepository } from '@nestjs/typeorm';
import { Group } from '../common/entities/group.entity';
import { Repository } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/service/redis.service';
import { UserGroup } from '../common/entities/user-group.entity';

@Injectable()
export class GroupService {
  constructor(
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
    private readonly cache: RedisService,
  ) {}

  async getUserGroups(userId: string): Promise<number[]> {
    const cachedUserGroups = await this.cache.get(`user:groups:${userId}`);
    if (cachedUserGroups) {
      return JSON.parse(cachedUserGroups);
    }
    const userGroups = await this.groupRepository
      .createQueryBuilder('group')
      .leftJoin(UserGroup, 'ug', 'ug.groupId = group.id')
      .where('ug.userId = :userId', { userId })
      .getMany();
    const groupIds = userGroups.map((group) => group.id);
    await this.cache.set(`user:groups:${userId}`, JSON.stringify(groupIds));
    return groupIds;
  }
}
