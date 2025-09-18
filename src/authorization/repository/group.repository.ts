import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Group } from 'src/common/entities/group.entity';
import { UserGroup } from 'src/common/entities/user-group.entity';

@Injectable()
export class GroupRepository {
  constructor(
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
  ) {}

  async findOne(where: FindOptionsWhere<Group>): Promise<Group | null> {
    return this.groupRepository.findOne({ where });
  }

  async findUserRoleByUserId(userId: number): Promise<Group[]> {
    return this.groupRepository
      .createQueryBuilder('group')
      .leftJoin(UserGroup, 'ug', 'ug.groupId = group.id')
      .where('ug.userId = :userId', { userId })
      .getMany();
  }
}
