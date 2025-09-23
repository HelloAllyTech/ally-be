import { Injectable } from '@nestjs/common';
import { GroupPermissionsRepository } from '../repository/group-permissions.repository';

@Injectable()
export class GroupPermissionsService {
  constructor(
    private readonly groupPermissionsRepository: GroupPermissionsRepository,
  ) {}

  async getGroupPermissions(
    groupIds: number[],
  ): Promise<{ groupId: number; permission: string }[]> {
    const permissions =
      await this.groupPermissionsRepository.findPermissionsByGroupId(groupIds);

    return permissions;
  }
}
